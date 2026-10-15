// Pago protegido piloto: custodia simple (ver lib/protected.ts).
// Solo tiendas voluntarias (stores.protected_enabled) y tope por pedido.
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, stores, users, violations, protectedPayments } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  WOMPI_PRIVATE_KEY,
  WOMPI_PUBLIC_KEY,
  createNequiTransaction,
  getWompiTransaction,
} from "../lib/wompi";
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
  if (!WOMPI_PRIVATE_KEY || !WOMPI_PUBLIC_KEY) {
    res.status(503).json({ error: "Wompi no está configurado aún (llaves WOMPI_*)" });
    return false;
  }
  return true;
}

/** Aplica un cobro Wompi APPROVED a un pago protegido (idempotente). */
export async function applyProtectedApproved(tx: {
  id: string;
  status: string;
  amountInCents: number | null;
}): Promise<{ handled: boolean; approved?: boolean }> {
  const [row] = await db
    .select()
    .from(protectedPayments)
    .where(eq(protectedPayments.wompiTxId, tx.id))
    .limit(1);
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
  // Cobrado → retenido directo (la retención arranca al cobrarse).
  await db
    .update(protectedPayments)
    .set({ status: "held", collected: String(expected) })
    .where(eq(protectedPayments.id, row.id));
  return { handled: true, approved: true };
}

// Crear el cobro protegido para un pedido pendiente (solo la clienta).
// POST /api/protected/checkout { orderId, phoneNumber }
router.post("/checkout", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z
    .object({ orderId: z.string().uuid(), phoneNumber: z.string().regex(PHONE_RX, "Número Nequi inválido (10 dígitos, empieza en 3).") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pedido o Nequi inválidos." });
  const { orderId, phoneNumber } = parsed.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado." });
  if (order.status !== "pending") return res.status(409).json({ error: "Este pedido ya no está pendiente." });
  if (order.customerId !== req.userId) {
    return res.status(403).json({ error: "Solo quien hizo el pedido puede pagarlo." });
  }
  const [store] = await db
    .select({ id: stores.id, name: stores.name, protectedEnabled: stores.protectedEnabled })
    .from(stores)
    .where(eq(stores.id, order.storeId))
    .limit(1);
  if (!store?.protectedEnabled) {
    return res.status(403).json({ error: "Esta tienda aún no acepta pago protegido." });
  }
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const total = items.reduce((acc, it) => acc + Number(it.unitPrice) * Number(it.quantity), 0);
  if (!(total > 0)) return res.status(400).json({ error: "El pedido no tiene monto válido." });
  if (total > PROTECTED_MAX_TOTAL) {
    return res.status(400).json({ error: `El piloto cubre pedidos hasta $${PROTECTED_MAX_TOTAL.toLocaleString("es-CO")}.` });
  }

  // Idempotente: si ya hay fila para este pedido, devolverla.
  const [existing] = await db
    .select()
    .from(protectedPayments)
    .where(eq(protectedPayments.orderId, order.id))
    .limit(1);
  if (existing) return res.json({ ...existing, charge: Math.round(Number(existing.total) + Number(existing.buyerFee)) });

  const split = splitFees(total);
  if (!wompiReady(res)) return;
  const reference = `PROT_${order.id.slice(0, 8)}_${Date.now().toString(36)}`;
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1);
  try {
    const tx = await createNequiTransaction({
      amountInCents: split.charge * 100,
      reference,
      customerEmail: me?.email ?? "cliente@ccplatform.com",
      phoneNumber,
    });
    const [row] = await db
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
        wompiTxId: tx.id || null,
      })
      .onConflictDoNothing()
      .returning();
    res.status(201).json({ ...(row ?? null), transactionId: tx.id, statusTx: tx.status, charge: split.charge, sellerNet: split.sellerNet });
  } catch (err) {
    console.error("protected checkout error:", err);
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
router.post("/:id/release", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const [row] = await db.select().from(protectedPayments).where(eq(protectedPayments.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "No encontrado." });
  const [store] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, row.storeId)).limit(1);
  if (store?.ownerId !== req.userId) return res.status(403).json({ error: "Solo la dueña libera." });
  if (!canTransition(row.status, "released")) return res.status(409).json({ error: `No se puede liberar desde ${row.status}.` });
  const [updated] = await db
    .update(protectedPayments)
    .set({ status: "released", releasedAt: new Date() })
    .where(and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, "held")))
    .returning();
  if (!updated) return res.status(409).json({ error: "Ya cambió de estado." });
  res.json(updated);
});

// Devolver (dueña, antes del desembolso; la devolución del dinero es manual
// en el piloto y queda registrada). POST /api/protected/:id/refund
router.post("/:id/refund", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const [row] = await db.select().from(protectedPayments).where(eq(protectedPayments.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "No encontrado." });
  const [store] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, row.storeId)).limit(1);
  if (store?.ownerId !== req.userId) return res.status(403).json({ error: "Solo la dueña devuelve." });
  if (!canTransition(row.status, "refunded")) return res.status(409).json({ error: `No se puede devolver desde ${row.status}.` });
  const [updated] = await db
    .update(protectedPayments)
    .set({ status: "refunded" })
    .where(eq(protectedPayments.id, row.id))
    .returning();
  res.json({ ...updated, note: "Devuelve el dinero a la compradora por Nequi manual y listo." });
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
router.post("/:id/mark-paid", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const [row] = await db.select().from(protectedPayments).where(eq(protectedPayments.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "No encontrado." });
  const [store] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, row.storeId)).limit(1);
  if (store?.ownerId !== req.userId) return res.status(403).json({ error: "Solo la dueña marca el pago." });
  if (row.status !== "released") return res.status(409).json({ error: "Solo lo liberado se marca pagado." });
  const [updated] = await db
    .update(protectedPayments)
    .set({ status: "paid_out", paidOutAt: new Date() })
    .where(and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, "released")))
    .returning();
  res.json(updated ?? row);
});

export default router;
