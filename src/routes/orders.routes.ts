// Panel de pedidos del comerciante (Fase 2). Un pedido `pending` lo crea la IA
// en el chat cuando un cliente confirma una compra (sin tocar stock ni
// estadísticas). Aquí el comerciante lo confirma (→ venta origin='order', que
// descuenta stock) o lo cancela. Ventas con origin='order' están respaldadas
// por un cliente real: no cuentan como inflación de prestigio.
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, stores, users, products, protectedPayments } from "../db/schema";
import { createSale } from "../lib/sales";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { myWorkStore } from "../lib/members";
import { createGuestOrder, findGuestOrder } from "../lib/guest";
import { PSE_SCHEMA } from "../lib/pse";
import { guestCheckoutLimiter, guestStatusLimiter, guestResendLimiter, guestReportLimiter } from "../middleware/rate-limit";
import { getWompiTransaction } from "../lib/wompi";
import { notifyUser } from "../lib/push";
import { sendMerchantBuyerReportedPaid, sendGuestOrderCode, emailConfigured } from "../lib/email";
import { generateGuestCode, hashGuestCode } from "../lib/crypto";
import { recordBuyerReport, buyerReportMessage } from "../lib/moderation";

const router = Router();

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Listar pedidos de la tienda donde trabajo (dueña o colaboradora; todos
// los estados, recientes primero). Disponible en todos los planes.
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const work = await myWorkStore(req.userId!);
  if (!work) return res.status(404).json({ error: "No tienes una tienda." });
  const store = { id: work.id };

  const status = String(req.query.status ?? "").trim();
  const statusFilter =
    status === "pending" || status === "sold" || status === "cancelled"
      ? eq(orders.status, status)
      : undefined;
  const rows = await db.query.orders.findMany({
    where: statusFilter ? and(eq(orders.storeId, store.id), statusFilter) : eq(orders.storeId, store.id),
    orderBy: [desc(orders.createdAt)],
    with: {
      customer: { columns: { id: true, name: true } },
      items: true,
      sale: { columns: { id: true, total: true } },
    },
  });
  const withProtected = await attachProtected(rows);
  res.json(withProtected);
});

// Mis compras (clienta, tenga tienda o no): mis pedidos con items, tienda y
// estado del pago protegido. GET /api/orders/mine
router.get("/mine", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db.query.orders.findMany({
    where: eq(orders.customerId, req.userId!),
    orderBy: [desc(orders.createdAt)],
    limit: 50,
    with: {
      items: true,
      sale: { columns: { id: true, total: true } },
      store: { columns: { id: true, name: true, slug: true, logoUrl: true } },
    },
  });
  res.json(await attachProtected(rows));
});

/** Pega protectedStatus a una lista de pedidos (join por orderId). */
async function attachProtected<T extends { id: string }>(rows: T[]): Promise<(T & { protectedStatus: string | null })[]> {
  if (!rows.length) return rows.map((r) => ({ ...r, protectedStatus: null }));
  const pays = await db
    .select({ orderId: protectedPayments.orderId, status: protectedPayments.status })
    .from(protectedPayments)
    .where(
      inArray(
        protectedPayments.orderId,
        rows.map((r) => r.id),
      ),
    );
  const byOrder = new Map(pays.map((p) => [p.orderId, p.status as string]));
  return rows.map((r) => ({ ...r, protectedStatus: byOrder.get(r.id) ?? null }));
}

// Confirmar pedido → genera la venta (origin='order') y descuenta stock.
// Todo ocurre en UNA transacción con el pedido bloqueado (FOR UPDATE): si dos
// personas confirman a la vez, la segunda espera, ve status='sold' y recibe
// 409. Nunca se generan dos ventas ni se descuenta stock dos veces.
router.post("/:id/confirm", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });

  const work = await myWorkStore(req.userId!);
  if (!work) return res.status(404).json({ error: "No tienes una tienda." });
  const store = { id: work.id };

  const outcome = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, req.params.id), eq(orders.storeId, store.id)))
      .limit(1)
      .for("update");
    if (!order) return { kind: "error" as const, status: 404, error: "Pedido no encontrado." };
    if (order.status !== "pending") {
      return {
        kind: "error" as const,
        status: 409,
        error:
          order.status === "sold"
            ? "Este pedido ya fue confirmado."
            : "Este pedido ya fue cancelado.",
      };
    }

    const rows = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const items = rows
      .filter((it) => it.productId != null)
      .map((it) => ({ productId: it.productId!, quantity: Number(it.quantity) }));
    if (!items.length) {
      return { kind: "error" as const, status: 409, error: "Este pedido no tiene productos válidos." };
    }

    const result = await createSale(
      {
        storeId: store.id,
        customerId: order.customerId ?? null,
        origin: "order",
        note: order.note ?? null,
        items,
        stockAlreadyReserved: order.stockReserved,
      },
      tx as unknown as typeof db,
    );
    if (!result.ok) {
      return { kind: "error" as const, status: result.status, error: result.error };
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: "sold", saleId: result.sale.id, stockReserved: false })
      .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
      .returning();
    if (!updated) {
      return { kind: "error" as const, status: 409, error: "El pedido ya cambió de estado." };
    }
    return { kind: "ok" as const, updated, customerId: order.customerId };
  });

  if (outcome.kind === "error") {
    return res.status(outcome.status).json({ error: outcome.error });
  }

  // Push a la clienta: pedido confirmado (best-effort, después del commit).
  void (async () => {
    try {
      if (outcome.customerId) {
        const { notifyUser } = await import("../lib/push");
        await notifyUser(outcome.customerId, {
          title: "¡Pedido confirmado!",
          body: "La tienda confirmó tu pedido y lo está preparando.",
          data: { type: "order_confirmed", orderId: outcome.updated.id, storeId: store.id },
        });
      }
    } catch {
      /* push best-effort */
    }
  })();
  res.json(outcome.updated);
});

// Cancelar pedido pendiente. El UPDATE condicional es atómico: si el pedido
// pasa a 'sold' al mismo tiempo, no se cancela una venta ya generada. Si el
// pedido había reservado stock, se devuelve al inventario.
router.post("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });

  const work = await myWorkStore(req.userId!);
  if (!work) return res.status(404).json({ error: "No tienes una tienda." });
  const store = { id: work.id };

  const outcome = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, req.params.id), eq(orders.storeId, store.id)))
      .limit(1)
      .for("update");
    if (!order) return { kind: "notfound" as const };
    if (order.status !== "pending") {
      return {
        kind: "conflict" as const,
        error:
          order.status === "sold"
            ? "Este pedido ya fue confirmado."
            : "Este pedido ya fue cancelado.",
      };
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: "cancelled", stockReserved: false })
      .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
      .returning();
    if (!updated) {
      return { kind: "conflict" as const, error: "El pedido cambió de estado. Intenta de nuevo." };
    }

    // Devolver la reserva de stock (solo si este pedido la tomó al crearse).
    if (order.stockReserved) {
      const its = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      for (const it of its) {
        if (!it.productId) continue;
        const qty = Math.floor(Number(it.quantity));
        if (!(qty > 0)) continue;
        await tx
          .update(products)
          .set({
            stock: sql`${products.stock} + ${qty}`,
            available: sql`CASE WHEN ${products.stock} + ${qty} > 0 THEN true ELSE ${products.available} END`,
          })
          .where(eq(products.id, it.productId));
      }
    }

    return { kind: "ok" as const, updated };
  });

  if (outcome.kind === "notfound") return res.status(404).json({ error: "Pedido no encontrado." });
  if (outcome.kind === "conflict") return res.status(409).json({ error: outcome.error });

  const updated = outcome.updated;
  void (async () => {
    try {
      if (updated.customerId) {
        const { notifyUser } = await import("../lib/push");
        await notifyUser(updated.customerId, {
          title: "Pedido cancelado",
          body: "La tienda canceló tu pedido. Escríbeles por el chat si tienes dudas.",
          data: { type: "order_cancelled", orderId: updated.id, storeId: store.id },
        });
      }
    } catch {
      /* push best-effort */
    }
  })();
  res.json(updated);
});

// ── Compra de invitado (sin cuenta) ────────────────────────────────────────
const GUEST_SCHEMA = z
  .object({
    storeId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .min(1)
      .max(50),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(30).optional(),
    name: z.string().trim().max(120).optional(),
    paymentMethod: z.enum(["NEQUI", "PSE", "NEQUI_DIRECTO"]).default("NEQUI_DIRECTO"),
    phoneNumber: z.string().regex(/^3\d{9}$/, "Número Nequi inválido.").optional(),
    pse: PSE_SCHEMA.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === "NEQUI" && !value.phoneNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneNumber"], message: "Falta el número Nequi." });
    }
    if (value.paymentMethod === "PSE" && !value.pse) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pse"], message: "Faltan los datos de PSE." });
    }
  });

// POST /api/orders/guest — crea pedido + cobro sin registro. Devuelve el
// código de acceso UNA sola vez: sin él no se puede consultar la compra.
router.post("/guest", guestCheckoutLimiter, async (req, res) => {
  const parsed = GUEST_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos de compra inválidos.", detail: parsed.error.flatten() });
  }
  const result = await createGuestOrder(parsed.data);
  if (!result.ok) return res.status(result.status).json({ error: result.message, code: result.code });
  res.status(201).json({
    orderId: result.orderId,
    guestCode: result.guestCode,
    total: result.total,
    charge: result.charge,
    sellerNet: result.sellerNet,
    paymentMethod: result.paymentMethod,
    directNequi: result.directNequi ?? null,
    emailed: result.emailed,
    payment: null,
    note: "Guarda tu código: lo necesitas junto a tu email para consultar la compra.",
  });
});

// POST /api/orders/guest/paid — el comprador avisa que ya transfirió. No
// confirma el pago: solo marca el pedido y avisa al comerciante para que lo
// verifique. Idempotente y sin revelar datos a quien no tenga email + código.
router.post("/guest/paid", guestStatusLimiter, async (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  const code = String(req.body?.code ?? "").trim();
  if (!email || email.length > 200 || !code || code.length > 64) {
    return res.status(400).json({ error: "Email y código son obligatorios." });
  }

  const found = await findGuestOrder(email, code);
  if (!found) return res.status(404).json({ error: "No encontramos una compra con esos datos." });

  const [order] = await db.select().from(orders).where(eq(orders.id, found.id)).limit(1);
  if (!order) return res.status(404).json({ error: "No encontramos una compra con esos datos." });

  // Solo aplica a pago directo (transferencia al Nequi del comerciante).
  if (order.paymentMethod !== "NEQUI_DIRECTO") {
    return res.status(400).json({ error: "Este pedido no es de pago directo." });
  }
  // Pedido ya resuelto: no se toca, pero no se filtra nada.
  if (order.status !== "pending") {
    return res.json({ ok: true, status: order.status });
  }

  if (!order.buyerReportedPaidAt) {
    await db
      .update(orders)
      .set({ buyerReportedPaidAt: new Date() })
      .where(eq(orders.id, order.id));
      const [store] = await db
        .select({ ownerId: stores.ownerId, slug: stores.slug, name: stores.name })
        .from(stores)
        .where(eq(stores.id, order.storeId))
        .limit(1);
    if (store?.ownerId) {
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, store.ownerId))
        .limit(1);
      if (owner?.email) {
        const who = order.customerName?.trim() || email;
        const its = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
        const total = its.reduce((acc, it) => acc + Number(it.unitPrice) * Number(it.quantity), 0);
        await sendMerchantBuyerReportedPaid({
          ownerEmail: owner.email,
          storeName: store.name,
          customerName: order.customerName?.trim() || null,
          customerEmail: order.customerEmail || null,
          total,
          orderId: order.id,
          storeSlug: store.slug,
        });
      }
      const who = order.customerName?.trim() || email;
      void notifyUser(store.ownerId, {
        title: "El comprador dice que ya pagó",
        body: `${who} reportó el pago de un pedido. Verifica tu Nequi y confirma en Pedidos.`,
        data: { type: "order_paid_reported", orderId: order.id },
      }).catch(() => {});
    }
  }

  res.json({ ok: true, status: order.status });
});

// POST /api/orders/guest/resend-code — el comprador perdió su código. Solo
// email: rota el código del pedido pendiente más reciente y lo envía por
// correo. Respuesta genérica: no revela si el email tiene compras.
router.post("/guest/resend-code", guestResendLimiter, async (req, res) => {
  if (!emailConfigured()) {
    // Sin correo configurado NO rotamos el código: si lo hiciéramos, el
    // comprador perdería el único código válido y no recibiría el nuevo.
    return res.status(503).json({
      ok: false,
      code: "email_not_configured",
      message:
        "El envío de correos no está disponible en esta tienda. Guarda tu código actual; no lo cambiamos.",
    });
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email || email.length > 200) {
    return res.status(400).json({ error: "Email obligatorio." });
  }

  const [order] = await db
    .select({ id: orders.id, storeId: orders.storeId })
    .from(orders)
    .where(
      and(
        eq(orders.customerEmail, email),
        isNull(orders.customerId),
        eq(orders.paymentMethod, "NEQUI_DIRECTO"),
        eq(orders.status, "pending"),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  const okMessage =
    "Si hay una compra pendiente con ese email, te enviamos un código nuevo.";
  if (!order) return res.json({ ok: true, message: okMessage });

  const code = generateGuestCode();
  await db.update(orders).set({ guestCodeHash: hashGuestCode(code) }).where(eq(orders.id, order.id));

  const [store] = await db
    .select({ name: stores.name, slug: stores.slug, paymentNequi: stores.paymentNequi })
    .from(stores)
    .where(eq(stores.id, order.storeId))
    .limit(1);

  if (store) {
    const its = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const total = its.reduce((acc, it) => acc + Number(it.unitPrice) * Number(it.quantity), 0);
    await sendGuestOrderCode({
      email,
      orderId: order.id,
      guestCode: code,
      storeName: store.name,
      customerName: null,
      total,
      nequiPhone: store.paymentNequi ?? "",
      nequiHolder: store.name,
      storeSlug: store.slug,
    });
  }

  res.json({ ok: true, message: okMessage });
});

// POST /api/orders/guest/report — un invitado reporta un problema con su
// pedido (no le llegó, fue distinto, etc.). Email + código prueban que es su
// compra; se registra una violación `buyer_report` para el equipo. Un mismo
// pedido no se puede reportar dos veces (evita sanciones por duplicados).
const GUEST_REPORT_SCHEMA = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(5).max(500),
});

router.post("/guest/report", guestReportLimiter, async (req, res) => {
  const parsed = GUEST_REPORT_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Cuéntanos brevemente qué pasó (mínimo 5 caracteres)." });
  }

  const email = parsed.data.email.toLowerCase();
  const [order] = await db
    .select({
      id: orders.id,
      storeId: orders.storeId,
      guestReportedAt: orders.guestReportedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerEmail, email),
        eq(orders.guestCodeHash, hashGuestCode(parsed.data.code)),
        isNull(orders.customerId),
        inArray(orders.status, ["pending", "sold"]),
      ),
    )
    .limit(1);

  if (!order) return res.status(404).json({ error: "No encontramos esa compra." });
  if (order.guestReportedAt) {
    return res
      .status(429)
      .json({ error: "Ya reportaste este pedido. Nuestro equipo lo está revisando." });
  }

  // Marca atómica: solo el primero gana; evita doble violación si reintenta.
  const [claimed] = await db
    .update(orders)
    .set({ guestReportedAt: new Date() })
    .where(and(eq(orders.id, order.id), isNull(orders.guestReportedAt)))
    .returning({ id: orders.id });
  if (!claimed) {
    return res
      .status(429)
      .json({ error: "Ya reportaste este pedido. Nuestro equipo lo está revisando." });
  }

  const outcome = await recordBuyerReport({
    storeId: order.storeId,
    reason: parsed.data.reason,
    metadata: { orderId: order.id, channel: "guest", customerEmail: email },
  });

  res.status(201).json({
    ok: true,
    action: outcome.action,
    message: buyerReportMessage(outcome.action),
  });
});

// GET /api/orders/guest?email=&code= — consulta de invitado. No revela si el
// email existe: email y código incorrectos devuelven el mismo 404.
router.get("/guest", guestStatusLimiter, async (req, res) => {
  const email = String(req.query.email ?? "").trim();
  const code = String(req.query.code ?? "").trim();
  if (!email || email.length > 200 || !code || code.length > 64) {
    return res.status(400).json({ error: "Email y código son obligatorios." });
  }

  const found = await findGuestOrder(email, code);
  if (!found) return res.status(404).json({ error: "No encontramos una compra con esos datos." });

  const [order] = await db.query.orders.findMany({
    where: eq(orders.id, found.id),
    limit: 1,
    with: {
      items: true,
      store: { columns: { id: true, name: true, slug: true, logoUrl: true, whatsapp: true, paymentNequi: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "No encontramos una compra con esos datos." });

  const [pay] = await db
    .select()
    .from(protectedPayments)
    .where(eq(protectedPayments.orderId, order.id))
    .limit(1);

  // Auto-reparación: si PSE/Nequi ya aprobó pero el webhook no llegó, se
  // consulta el estado real en Wompi. El código de invitado es la credencial.
  if (pay && (pay.status === "initiated" || pay.status === "collected") && pay.wompiTxId) {
    try {
      const tx = await getWompiTransaction(pay.wompiTxId);
      if (tx) {
        const { applyProtectedApproved } = await import("./protected.routes");
        await applyProtectedApproved(tx);
      }
    } catch {
      /* polling best-effort */
    }
  }

  const [fresh] = await db
    .select()
    .from(protectedPayments)
    .where(eq(protectedPayments.orderId, order.id))
    .limit(1);

  res.json({
    orderId: order.id,
    status: order.status,
    createdAt: order.createdAt,
    note: order.note,
    paymentMethod: order.paymentMethod,
    buyerReportedPaidAt: order.buyerReportedPaidAt,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    store: order.store,
    payment: fresh
      ? {
          status: fresh.status,
          method: fresh.paymentMethod,
          total: Number(fresh.total),
          charge: Math.round(Number(fresh.total) + Number(fresh.buyerFee)),
          sellerNet: Number(fresh.sellerNet),
          releasedAt: fresh.releasedAt,
          paidOutAt: fresh.paidOutAt,
        }
      : null,
  });
});

export default router;