// Pedidos generados por la IA en el chat (Fase 2). Un pedido `pending` no toca
// stock ni estadísticas: lo crea el asistente cuando el cliente confirma una
// compra, y el comerciante lo confirma (→ venta origin='order') o lo cancela
// desde su panel de "Pedidos por confirmar".
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, products } from "../db/schema";

export interface PendingOrderItem {
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export type CreatePendingOrderResult =
  | { ok: true; orderId: string; items: PendingOrderItem[]; total: number }
  | { ok: false; status: number; code: string; message: string };

const MAX_QTY = 1000;

/**
 * Crea un pedido pendiente para el comerciante. Acepta un solo producto
 * (legado: `productName` + `quantity`) o una canasta de varios (`items`).
 * Valida que cada producto exista en la tienda, esté disponible y tenga stock
 * suficiente (mezclando cantidades de productos repetidos). No descuenta stock:
 * eso ocurre cuando el comerciante confirma el pedido.
 */
export async function createPendingOrder(args: {
  storeId: string;
  customerId: string;
  productName?: string;
  quantity?: number;
  items?: { productName: string; quantity: number }[];
}): Promise<CreatePendingOrderResult> {
  const raw =
    args.items && args.items.length
      ? args.items
      : args.productName
        ? [{ productName: args.productName, quantity: args.quantity ?? 1 }]
        : [];

  if (!raw.length) {
    return { ok: false, status: 400, code: "empty_order", message: "El pedido no tiene productos." };
  }

  // Mezcla ítems con el mismo producto: un mismo nombre no genera dos líneas.
  const aggregated = new Map<string, number>();
  for (const it of raw) {
    const qty = Math.floor(it.quantity);
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, status: 400, code: "invalid_quantity", message: "Cantidad inválida para el pedido." };
    }
    const name = String(it.productName).trim().slice(0, 120);
    if (!name) {
      return { ok: false, status: 400, code: "invalid_quantity", message: "Nombre de producto inválido." };
    }
    aggregated.set(name, (aggregated.get(name) ?? 0) + qty);
  }

  const lines: PendingOrderItem[] = [];
  const productRows: { id: string; name: string; unitPrice: string }[] = [];

  for (const [name, qty] of aggregated) {
    const [product] = await db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        available: products.available,
        stock: products.stock,
      })
      .from(products)
      .where(and(eq(products.storeId, args.storeId), eq(products.name, name)))
      .limit(1);

    if (!product) {
      return { ok: false, status: 404, code: "product_not_found", message: `No conozco "${name}" en este catálogo.` };
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

    productRows.push({ id: product.id, name: product.name, unitPrice: String(product.price) });
    lines.push({
      productName: product.name,
      unitPrice: Number(product.price),
      quantity: qty,
      lineTotal: Number(product.price) * qty,
    });
  }

  const [order] = await db
    .insert(orders)
    .values({ storeId: args.storeId, customerId: args.customerId })
    .returning();

  for (let i = 0; i < productRows.length; i++) {
    const p = productRows[i];
    const line = lines[i];
    await db.insert(orderItems).values({
      orderId: order.id,
      productId: p.id,
      name: p.name,
      unitPrice: p.unitPrice,
      quantity: String(line.quantity),
    });
  }

  const total = lines.reduce((acc, l) => acc + l.lineTotal, 0);

  return { ok: true, orderId: order.id, items: lines, total };
}