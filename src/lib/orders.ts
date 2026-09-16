// Pedidos generados por la IA en el chat (Fase 2). Un pedido `pending` no toca
// stock ni estadísticas: lo crea el asistente cuando el cliente confirma una
// compra, y el comerciante lo confirma (→ venta origin='order') o lo cancela
// desde su panel de "Pedidos por confirmar".
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, products } from "../db/schema";

export type CreatePendingOrderResult =
  | { ok: true; orderId: string; productName: string; unitPrice: number; quantity: number; total: number }
  | { ok: false; status: number; code: string; message: string };

/**
 * Crea un pedido pendiente para el comerciante. MVP: 1 producto por pedido.
 * Valida que el producto exista en la tienda, esté disponible y tenga stock
 * suficiente (si lleva control de stock).
 */
export async function createPendingOrder(args: {
  storeId: string;
  customerId: string;
  productName: string;
  quantity: number;
}): Promise<CreatePendingOrderResult> {
  const qty = Math.floor(args.quantity);
  if (!Number.isFinite(qty) || qty < 1 || qty > 1000) {
    return { ok: false, status: 400, code: "invalid_quantity", message: "Cantidad inválida para el pedido." };
  }

  const [product] = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      available: products.available,
      stock: products.stock,
    })
    .from(products)
    .where(and(eq(products.storeId, args.storeId), eq(products.name, args.productName)))
    .limit(1);

  if (!product) {
    return { ok: false, status: 404, code: "product_not_found", message: `No conozco "${args.productName}" en este catálogo.` };
  }
  if (!product.available) {
    return { ok: false, status: 409, code: "product_unavailable", message: `"${product.name}" no está disponible.` };
  }
  if (product.stock !== null && product.stock !== undefined && Number(product.stock) < qty) {
    return {
      ok: false,
      status: 409,
      code: "insufficient_stock",
      message: `Solo quedan ${product.stock} de "${product.name}".`,
    };
  }

  const [order] = await db
    .insert(orders)
    .values({ storeId: args.storeId, customerId: args.customerId })
    .returning();

  await db.insert(orderItems).values({
    orderId: order.id,
    productId: product.id,
    name: product.name,
    unitPrice: Number(product.price).toFixed(2),
    quantity: String(qty),
  });

  const unitPrice = Number(product.price);
  return { ok: true, orderId: order.id, productName: product.name, unitPrice, quantity: qty, total: unitPrice * qty };
}