// Compra de invitado (sin cuenta) para Cici Payments.
//
// Seguridad:
//  - El precio SIEMPRE se calcula en el servidor desde el catálogo; nunca se
//    confía en importes enviados por el navegador.
//  - El pedido se identifica por email + código de acceso de alta entropía.
//    En la base solo se guarda el HMAC del código.
//  - No hay stock retenido antes de pagar; el pedido queda pendiente y la
//    tienda lo confirma. Un pedido impago no descuenta inventario.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderItems, products, stores } from "../db/schema";
import { withOfferFlags } from "./offers";
import { generateGuestCode, hashGuestCode } from "./crypto";
import { notifyUser } from "./push";

export interface GuestItemInput {
  productId: string;
  quantity: number;
}

export type GuestOrderResult =
  | {
      ok: true;
      orderId: string;
      guestCode: string;
      total: number;
      charge: number;
      sellerNet: number;
      paymentMethod: "NEQUI_DIRECTO";
      /** Pago directo: número Nequi del comerciante (sin custodia). */
      directNequi: { phone: string; holder: string };
    }
  | { ok: false; status: number; code: string; message: string };

const MAX_ITEMS = 50;
const MAX_QTY = 100;

const money = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

export async function createGuestOrder(input: {
  storeId: string;
  items: GuestItemInput[];
  email: string;
  phone?: string;
  name?: string;
  // Se conserva el campo para rechazar clientes viejos con un error claro.
  paymentMethod: "NEQUI" | "PSE" | "NEQUI_DIRECTO";
  phoneNumber?: string;
  pse?: unknown;
}): Promise<GuestOrderResult> {
  const email = input.email.trim().toLowerCase();

  // Modelo único: el pago en línea es directo al Nequi del comerciante.
  if (input.paymentMethod !== "NEQUI_DIRECTO") {
    return {
      ok: false,
      status: 410,
      code: "direct_only",
      message: "El pago en línea ahora es directo por Nequi.",
    };
  }

  const [store] = await db
    .select({
      id: stores.id,
      ownerId: stores.ownerId,
      name: stores.name,
      status: stores.status,
      paymentNequi: stores.paymentNequi,
    })
    .from(stores)
    .where(eq(stores.id, input.storeId))
    .limit(1);
  if (!store || store.status !== "ACTIVE") {
    return { ok: false, status: 404, code: "store_not_found", message: "Tienda no encontrada." };
  }
  if (!store.paymentNequi) {
    return {
      ok: false,
      status: 409,
      code: "no_nequi_channel",
      message: "Esta tienda aún no tiene un Nequi para recibir pagos.",
    };
  }

  // Agrupa cantidades por producto (un mismo producto no genera dos líneas).
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    const qty = Math.floor(Number(item.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, status: 400, code: "invalid_quantity", message: "Cantidad inválida." };
    }
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + qty);
  }
  if (!quantities.size || quantities.size > MAX_ITEMS) {
    return { ok: false, status: 400, code: "invalid_items", message: "El pedido no tiene productos válidos." };
  }

  const ids = [...quantities.keys()];
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      offerPrice: products.offerPrice,
      offerEndsAt: products.offerEndsAt,
      available: products.available,
      stock: products.stock,
    })
    .from(products)
    .where(and(eq(products.storeId, store.id), inArray(products.id, ids)));

  if (rows.length !== ids.length) {
    return { ok: false, status: 404, code: "product_not_found", message: "Algún producto ya no existe en esta tienda." };
  }

  const lines = rows.map((product) => {
    const qty = quantities.get(product.id)!;
    const effective = withOfferFlags({
      price: product.price,
      offerPrice: product.offerPrice,
      offerEndsAt: product.offerEndsAt,
    }).effectivePrice;
    return { product, qty, unitPrice: effective };
  });

  for (const line of lines) {
    if (!line.product.available) {
      return { ok: false, status: 409, code: "product_unavailable", message: `"${line.product.name}" no está disponible.` };
    }
    if (line.product.stock != null && Number(line.product.stock) < line.qty) {
      return { ok: false, status: 409, code: "insufficient_stock", message: `Solo quedan ${line.product.stock} de "${line.product.name}".` };
    }
  }

  const total = lines.reduce((acc, line) => acc + line.unitPrice * line.qty, 0);
  if (!(total > 0)) {
    return { ok: false, status: 400, code: "invalid_total", message: "El pedido no tiene monto válido." };
  }

  // Pago directo: el 100% va al comerciante (la plataforma solo cobra el plan).
  const guestCode = generateGuestCode();
  const guestCodeHash = hashGuestCode(guestCode);

  const created = await db.transaction(async (trx) => {
    const [order] = await trx
      .insert(orders)
      .values({
        storeId: store.id,
        customerId: null,
        status: "pending",
        customerName: input.name?.trim().slice(0, 120) || null,
        customerEmail: email,
        customerPhone: input.phone?.trim().slice(0, 30) || null,
        guestCodeHash,
        paymentMethod: input.paymentMethod,
      })
      .returning({ id: orders.id });
    if (!order) return null;

    await trx.insert(orderItems).values(
      lines.map((line) => ({
        orderId: order.id,
        productId: line.product.id,
        name: line.product.name,
        unitPrice: money(line.unitPrice),
        quantity: String(line.qty),
      })),
    );

    return { orderId: order.id };
  });

  if (!created) {
    return { ok: false, status: 500, code: "order_failed", message: "No se pudo crear el pedido." };
  }

  // Pago directo: no se crea cobro en Wompi. El comprador transfiere al Nequi
  // del comerciante y este confirma el pedido desde su panel.
  // Best-effort: avisa al comerciante que entró un pedido por confirmar.
  // El panel de pedidos es la fuente confiable; el push puede no existir.
  if (store.ownerId) {
    void notifyUser(store.ownerId, {
      title: "Nuevo pedido por Nequi",
      body: `${input.name?.trim().slice(0, 60) || "Un cliente"} pidió ${money(total)}. Confirma cuando recibas el pago.`,
      data: { type: "order_pending", orderId: created.orderId },
    }).catch(() => {});
  }
  return {
    ok: true,
    orderId: created.orderId,
    guestCode,
    total,
    charge: total,
    sellerNet: total,
    paymentMethod: "NEQUI_DIRECTO",
    directNequi: { phone: store.paymentNequi!, holder: store.name },
  };
}

/**
 * Busca un pedido de invitado por email + código. Devuelve null si no coincide
 * (no distingue entre email inexistente y código incorrecto).
 */
export async function findGuestOrder(email: string, code: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !code.trim()) return null;
  const hash = hashGuestCode(code);
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerEmail, normalized), eq(orders.guestCodeHash, hash)))
    .limit(1);
  return order ?? null;
}
