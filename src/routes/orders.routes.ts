// Panel de pedidos del comerciante (Fase 2). Un pedido `pending` lo crea la IA
// en el chat cuando un cliente confirma una compra (sin tocar stock ni
// estadísticas). Aquí el comerciante lo confirma (→ venta origin='order', que
// descuenta stock) o lo cancela. Ventas con origin='order' están respaldadas
// por un cliente real: no cuentan como inflación de prestigio.
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders, stores } from "../db/schema";
import { createSale } from "../lib/sales";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Listar pedidos de la tienda del comerciante (todos los estados, recientes
// primero; se puede filtrar por `?status=pending|sold|cancelled`). Disponible
// en todos los planes: en FREE el modo es manual.
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

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
  res.json(rows);
});

// Confirmar pedido → genera la venta (origin='order') y descuenta stock.
router.post("/:id/confirm", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, req.params.id), eq(orders.storeId, store.id)),
    with: { items: true },
  });
  if (!order) return res.status(404).json({ error: "Pedido no encontrado." });
  if (order.status !== "pending") {
    return res.status(409).json({ error: order.status === "sold" ? "Este pedido ya fue confirmado." : "Este pedido ya fue cancelado." });
  }

  const item = order.items[0];
  if (!item || item.productId == null) {
    return res.status(409).json({ error: "Este pedido no tiene un producto válido." });
  }

  const result = await createSale({
    storeId: store.id,
    customerId: order.customerId ?? null,
    origin: "order",
    note: order.note ?? null,
    items: [{ productId: item.productId, quantity: Number(item.quantity) }],
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  const [updated] = await db
    .update(orders)
    .set({ status: "sold", saleId: result.sale.id })
    .where(eq(orders.id, order.id))
    .returning();
  res.json(updated);
});

// Cancelar pedido pendiente.
router.post("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.storeId, store.id)))
    .limit(1);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado." });
  if (order.status !== "pending") {
    return res.status(409).json({ error: order.status === "sold" ? "Este pedido ya fue confirmado." : "Este pedido ya fue cancelado." });
  }

  const [updated] = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(eq(orders.id, order.id))
    .returning();
  res.json(updated);
});

export default router;