// Panel de pedidos del comerciante (Fase 2). Un pedido `pending` lo crea la IA
// en el chat cuando un cliente confirma una compra (sin tocar stock ni
// estadísticas). Aquí el comerciante lo confirma (→ venta origin='order', que
// descuenta stock) o lo cancela. Ventas con origin='order' están respaldadas
// por un cliente real: no cuentan como inflación de prestigio.
import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, stores, protectedPayments } from "../db/schema";
import { createSale } from "../lib/sales";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { myWorkStore } from "../lib/members";

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
      },
      tx as unknown as typeof db,
    );
    if (!result.ok) {
      return { kind: "error" as const, status: result.status, error: result.error };
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: "sold", saleId: result.sale.id })
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
// pasa a 'sold' al mismo tiempo, no se cancela una venta ya generada.
router.post("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });

  const work = await myWorkStore(req.userId!);
  if (!work) return res.status(404).json({ error: "No tienes una tienda." });
  const store = { id: work.id };

  const [updated] = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(orders.id, req.params.id),
        eq(orders.storeId, store.id),
        eq(orders.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    const [order] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, req.params.id), eq(orders.storeId, store.id)))
      .limit(1);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado." });
    return res.status(409).json({
      error: order.status === "sold" ? "Este pedido ya fue confirmado." : "Este pedido ya fue cancelado.",
    });
  }

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

export default router;