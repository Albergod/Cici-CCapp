// Pago protegido piloto: custodia simple (ver lib/protected.ts).
// Solo tiendas voluntarias (stores.protected_enabled) y tope por pedido.
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, stores, users, violations, protectedPayments } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  WOMPI_PRIVATE_KEY,
  WOMPI_PUBLIC_KEY,
  createNequiTransaction,
  getWompiTransaction,
} from "../lib/wompi";
import { paymentEnvironmentError } from "../lib/env";
import {
  PROTECTED_MAX_TOTAL,
  canTransition,
  payoutReport,
  splitFees,
  storeBalance,
} from "../lib/protected";

const router = Router();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RX = /^3\d{9}$/;

function wompiReady(res: any): boolean {
  const envError = paymentEnvironmentError();
  if (envError) {
    res.status(503).json({ error: envError });
    return false;
  }
  if (!WOMPI_PRIVATE_KEY || !WOMPI_PUBLIC_KEY) {
    res.status(503).json({ error: "Wompi no está configurado aún (llaves WOMPI_*)" });
    return false;
  }
  return true;
}

/** Aplica un cobro Wompi APPROVED a un pago protegido (idempotente).
 *  Bloquea la fila (FOR UPDATE) para que webhook y polling concurrentes no
 *  compitan con una devolución/cancelación: gana una sola transición. */
export async function applyProtectedApproved(tx: {
  id: string;
  status: string;
  amountInCents: number | null;
}): Promise<{ handled: boolean; approved?: boolean }> {
  return db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.wompiTxId, tx.id))
      .limit(1)
      .for("update");
    if (!row) return { handled: false };
    if (tx.status !== "APPROVED") return { handled: true, approved: false };
    if (row.status === "held" || row.status === "released" || row.status === "paid_out") {
      return { handled: true, approved: true };
    }
    if (!canTransition(row.status, "collected")) return { handled: true, approved: false };
    const expected = Math.round(Number(row.total) + Number(row.buyerFee));
    if (tx.amountInCents !== null && tx.amountInCents > 0 && tx.amountInCents !== expected * 100) {
      return { handled: true, approved: false };
    }
    // Cobrado → retenido directo (la retención arranca al cobrarse). El WHERE
    // por estado evita pisar una devolución/cancelación concurrente.
    const [updated] = await trx
      .update(protectedPayments)
      .set({ status: "held", collected: String(expected) })
      .where(
        and(
          eq(protectedPayments.id, row.id),
          inArray(protectedPayments.status, ["initiated", "collected"]),
        ),
      )
      .returning({ id: protectedPayments.id });
    return { handled: true, approved: Boolean(updated) };
  });
}

// Crear el cobro protegido para un pedido pendiente (solo la clienta).
// POST /api/protected/checkout { orderId, phoneNumber }
//
// Se reserva PRIMERO la fila (unique por orderId) y solo después se crea el
// cobro en Wompi. Dos pestañas simultáneas no pueden generar dos cobros: la
// segunda encuentra la reserva y recibe 409 mientras la primera termina.
router.post("/checkout", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z
    .object({ orderId: z.string().uuid(), phoneNumber: z.string().regex(PHONE_RX, "Número Nequi inválido (10 dígitos, empieza en 3).") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pedido o Nequi inválidos." });
  const { orderId, phoneNumber } = parsed.data;

  const reservation = await db.transaction(async (trx) => {
    // Bloquea el pedido: evita pagar un pedido que se confirma/cancela a la vez.
    const [order] = await trx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");
    if (!order) return { kind: "error" as const, status: 404, error: "Pedido no encontrado." };
    if (order.status !== "pending") {
      return { kind: "error" as const, status: 409, error: "Este pedido ya no está pendiente." };
    }
    if (order.customerId !== req.userId) {
      return { kind: "error" as const, status: 403, error: "Solo quien hizo el pedido puede pagarlo." };
    }
    const [store] = await trx
      .select({ id: stores.id, name: stores.name, protectedEnabled: stores.protectedEnabled })
      .from(stores)
      .where(eq(stores.id, order.storeId))
      .limit(1);
    if (!store?.protectedEnabled) {
      return { kind: "error" as const, status: 403, error: "Esta tienda aún no acepta pago protegido." };
    }
    const items = await trx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const total = items.reduce((acc, it) => acc + Number(it.unitPrice) * Number(it.quantity), 0);
    if (!(total > 0)) return { kind: "error" as const, status: 400, error: "El pedido no tiene monto válido." };
    if (total > PROTECTED_MAX_TOTAL) {
      return {
        kind: "error" as const,
        status: 400,
        error: `El piloto cubre pedidos hasta $${PROTECTED_MAX_TOTAL.toLocaleString("es-CO")}.`,
      };
    }

    const [existing] = await trx
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, order.id))
      .limit(1)
      .for("update");
    if (existing) {
      if (existing.wompiTxId) return { kind: "existing" as const, row: existing };
      // Reserva sin cobro: si es reciente, otro request está en vuelo.
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs < 2 * 60 * 1000) return { kind: "busy" as const };
      // Reserva huérfana (proceso caído): se descarta y se reintenta.
      await trx.delete(protectedPayments).where(eq(protectedPayments.id, existing.id));
    }

    const split = splitFees(total);
    const [row] = await trx
      .insert(protectedPayments)
      .values({
        orderId: order.id,
        storeId: store.id,
        customerId: req.userId!,
        total: String(total),
        buyerFee: String(split.buyerFee),
        sellerFee: String(split.sellerFee),
        sellerNet: String(split.sellerNet),
        status: "initiated",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return { kind: "busy" as const };
    return { kind: "reserved" as const, row, split };
  });

  if (reservation.kind === "error") {
    return res.status(reservation.status).json({ error: reservation.error });
  }
  if (reservation.kind === "busy") {
    return res.status(409).json({ error: "Ya hay un cobro en proceso para este pedido. Espera unos segundos." });
  }
  if (reservation.kind === "existing") {
    const row = reservation.row;
    return res.json({
      ...row,
      charge: Math.round(Number(row.total) + Number(row.buyerFee)),
    });
  }

  if (!wompiReady(res)) {
    await db.delete(protectedPayments).where(eq(protectedPayments.id, reservation.row.id));
    return;
  }

  const reference = `PROT_${orderId.slice(0, 8)}_${Date.now().toString(36)}`;
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
  try {
    const tx = await createNequiTransaction({
      amountInCents: reservation.split.charge * 100,
      reference,
      customerEmail: me?.email ?? "cliente@ccplatform.com",
      phoneNumber,
    });
    if (!tx.id) throw new Error("Wompi no devolvió el id de la transacción");
    const [row] = await db
      .update(protectedPayments)
      .set({ wompiTxId: tx.id })
      .where(and(eq(protectedPayments.id, reservation.row.id), sql`${protectedPayments.wompiTxId} IS NULL`))
      .returning();
    if (!row) throw new Error("La reserva cambió durante la creación del cobro");
    res.status(201).json({
      ...row,
      transactionId: tx.id,
      statusTx: tx.status,
      charge: reservation.split.charge,
      sellerNet: reservation.split.sellerNet,
    });
  } catch (err) {
    console.error("protected checkout error:", err);
    // Libera la reserva para permitir reintentar; si ya hay tx, se conserva.
    await db
      .delete(protectedPayments)
      .where(and(eq(protectedPayments.id, reservation.row.id), sql`${protectedPayments.wompiTxId} IS NULL`))
      .catch(() => undefined);
    res.status(502).json({ error: "No se pudo crear el cobro por Nequi." });
  }
});

// Estado del cobro (polling mientras aprueba en Nequi). GET /api/protected/status?orderId=
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const orderId = String(req.query.orderId ?? "").trim();
  if (!UUID_RX.test(orderId)) return res.status(400).json({ error: "ID inválido." });
  const [row] = await db.select().from(protectedPayments).where(eq(protectedPayments.orderId, orderId)).limit(1);
  if (!row) return res.status(404).json({ error: "Sin pago protegido para este pedido." });
  // Solo involucrados.
  const [order] = await db.select({ customerId: orders.customerId, storeId: orders.storeId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  const [store] = order ? await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, order.storeId)).limit(1) : [];
  if (order?.customerId !== req.userId && store?.ownerId !== req.userId) {
    return res.status(403).json({ error: "No autorizado." });
  }
  if ((row.status === "initiated" || row.status === "collected") && row.wompiTxId) {
    try {
      const tx = await getWompiTransaction(row.wompiTxId);
      if (tx) await applyProtectedApproved(tx);
    } catch {
      /* polling best-effort */
    }
  }
  const [fresh] = await db.select().from(protectedPayments).where(eq(protectedPayments.id, row.id)).limit(1);
  res.json(fresh);
});

// Liberar anticipado (dueña). POST /api/protected/:id/release
// Transacción + FOR UPDATE: liberar y devolver a la vez solo puede ganar una.
router.post("/:id/release", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const outcome = await db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.id, req.params.id))
      .limit(1)
      .for("update");
    if (!row) return { kind: "error" as const, status: 404, error: "No encontrado." };
    const [store] = await trx
      .select({ ownerId: stores.ownerId })
      .from(stores)
      .where(eq(stores.id, row.storeId))
      .limit(1);
    if (store?.ownerId !== req.userId) {
      return { kind: "error" as const, status: 403, error: "Solo la dueña libera." };
    }
    if (!canTransition(row.status, "released")) {
      return {
        kind: "error" as const,
        status: 409,
        error: `No se puede liberar desde ${row.status}.`,
      };
    }
    const [updated] = await trx
      .update(protectedPayments)
      .set({ status: "released", releasedAt: new Date() })
      .where(and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, "held")))
      .returning();
    if (!updated) return { kind: "error" as const, status: 409, error: "Ya cambió de estado." };
    return { kind: "ok" as const, updated };
  });
  if (outcome.kind === "error") return res.status(outcome.status).json({ error: outcome.error });
  res.json(outcome.updated);
});

// Devolver (dueña, antes del desembolso; la devolución del dinero es manual
// en el piloto y queda registrada). POST /api/protected/:id/refund
router.post("/:id/refund", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const outcome = await db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.id, req.params.id))
      .limit(1)
      .for("update");
    if (!row) return { kind: "error" as const, status: 404, error: "No encontrado." };
    const [store] = await trx
      .select({ ownerId: stores.ownerId })
      .from(stores)
      .where(eq(stores.id, row.storeId))
      .limit(1);
    if (store?.ownerId !== req.userId) {
      return { kind: "error" as const, status: 403, error: "Solo la dueña devuelve." };
    }
    if (!canTransition(row.status, "refunded")) {
      return {
        kind: "error" as const,
        status: 409,
        error: `No se puede devolver desde ${row.status}.`,
      };
    }
    const [updated] = await trx
      .update(protectedPayments)
      .set({ status: "refunded" })
      .where(and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, row.status)))
      .returning();
    if (!updated) return { kind: "error" as const, status: 409, error: "Ya cambió de estado." };
    return { kind: "ok" as const, updated };
  });
  if (outcome.kind === "error") return res.status(outcome.status).json({ error: outcome.error });
  res.json({ ...outcome.updated, note: "Devuelve el dinero a la compradora por Nequi manual y listo." });
});

// Reportar problema con un pago protegido (compradora). Crea una violación
// visible para el admin, avisa a la dueña y congela la liberación: un pago
// en disputa NO lo suelta el cron hasta resolverse.
// POST /api/protected/dispute { orderId, reason }
router.post("/dispute", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z
    .object({ orderId: z.string().uuid(), reason: z.string().trim().min(10, "Cuéntanos qué pasó (mínimo 10 letras).").max(500) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Cuéntanos qué pasó (mínimo 10 letras)." });
  const { orderId, reason } = parsed.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.customerId !== req.userId) {
    return res.status(404).json({ error: "Pedido no encontrado." });
  }
  const [pay] = await db.select().from(protectedPayments).where(eq(protectedPayments.orderId, orderId)).limit(1);
  if (!pay || !["collected", "held", "released"].includes(pay.status)) {
    return res.status(409).json({ error: "Este pedido no tiene un pago retenido que disputar." });
  }
  const [dup] = await db
    .select({ id: violations.id })
    .from(violations)
    .where(
      and(
        eq(violations.status, "OPEN"),
        sql`(${violations.metadata} ->> 'orderId') = ${orderId}`,
      ),
    )
    .limit(1);
  if (dup) return res.status(409).json({ error: "Ya hay una disputa abierta por este pedido." });

  const { insertViolation } = await import("../lib/moderation");
  await insertViolation({
    type: "order_dispute",
    severity: "warning",
    storeId: pay.storeId,
    reporterId: req.userId!,
    reason: reason.trim(),
    metadata: { orderId, protectedId: pay.id, kind: "protected_dispute" },
  });

  void (async () => {
    try {
      const { notifyUser } = await import("../lib/push");
      const [store] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, pay.storeId)).limit(1);
      if (store && store.ownerId !== req.userId) {
        await notifyUser(store.ownerId, {
          title: "Disputa abierta en un pago",
          body: "Una compradora reportó un problema. Revisa el pedido y escribele.",
          data: { type: "dispute", orderId, storeId: pay.storeId },
        });
      }
    } catch {
      /* best-effort */
    }
  })();

  res.status(201).json({ ok: true, message: "Disputa abierta. Revisaremos el caso y te avisamos." });
});
router.get("/mine", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, req.userId!)).limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const { storeBalance } = await import("../lib/protected");
  const [balance, history] = await Promise.all([
    storeBalance(store.id),
    db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.storeId, store.id))
      .orderBy(desc(protectedPayments.createdAt))
      .limit(50),
  ]);
  res.json({ balance, history });
});

// Reporte semanal para los Nequis manuales (operador = dueño revisando sus
// tiendas; en piloto el operador eres tú con tu login).
// GET /api/protected/payout-report
router.get("/payout-report", requireAuth, async (req: AuthRequest, res) => {
  const mine = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, req.userId!));
  const ids = new Set(mine.map((s) => s.id));
  const rows = (await payoutReport()).filter((r) => ids.has(r.storeId));
  const total = rows.reduce((acc, r) => acc + Number(r.sellerNet), 0);
  res.json({ rows, total, count: rows.length });
});

// Marcar pagado tras el Nequi manual. POST /api/protected/:id/mark-paid
// Body opcional: { payoutReference } (comprobante Nequi/bancario).
// Idempotente: repetir la llamada devuelve el mismo pago, no duplica ni falla.
router.post("/:id/mark-paid", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const parsed = z
    .object({ payoutReference: z.string().trim().max(120).optional() })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Referencia de desembolso inválida." });

  const outcome = await db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.id, req.params.id))
      .limit(1)
      .for("update");
    if (!row) return { kind: "error" as const, status: 404, error: "No encontrado." };
    const [store] = await trx
      .select({ ownerId: stores.ownerId })
      .from(stores)
      .where(eq(stores.id, row.storeId))
      .limit(1);
    if (store?.ownerId !== req.userId) {
      return { kind: "error" as const, status: 403, error: "Solo la dueña marca el pago." };
    }
    // Idempotencia real: un segundo clic devuelve el pago ya marcado.
    if (row.status === "paid_out") return { kind: "ok" as const, updated: row };
    if (row.status !== "released") {
      return { kind: "error" as const, status: 409, error: "Solo lo liberado se marca pagado." };
    }
    const [updated] = await trx
      .update(protectedPayments)
      .set({
        status: "paid_out",
        paidOutAt: new Date(),
        paidOutBy: req.userId!,
        payoutReference: parsed.data.payoutReference ?? null,
      })
      .where(and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, "released")))
      .returning();
    if (!updated) return { kind: "error" as const, status: 409, error: "Ya cambió de estado." };
    return { kind: "ok" as const, updated };
  });
  if (outcome.kind === "error") return res.status(outcome.status).json({ error: outcome.error });
  res.json(outcome.updated);
});

export default router;
