import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { products, sales, saleItems, storeServices, stores } from "../db/schema";
import {
  INFLATED_SALE_DAY_BURST,
  TRACKED_PAYMENT_METHODS,
  insertViolation,
  refreshStoreStatus,
  storeOperational,
} from "./moderation";
import { withOfferFlags } from "./offers";

// Origen de la venta. `manual` la registra el comerciante a mano; `appointment`
// se genera al cerrar una cita ("Listo"); `order` al confirmar un pedido del
// chat. Las ventas con respaldo (cita/pedido) no cuentan para el anti-fraude de
// ventas infladas: tienen un cliente real detrás.
export type SaleOrigin = "manual" | "appointment" | "order";

export type SaleItemInput = {
  productId?: string | null;
  serviceId?: string | null;
  quantity: number;
};

export type CreateSaleInput = {
  storeId: string;
  items: SaleItemInput[];
  note?: string | null;
  customerId?: string | null;
  paymentMethod?: string | null;
  origin?: SaleOrigin;
};

export type CreatedSale = {
  id: string;
  storeId: string;
  total: number;
  note: string | null;
  customerId: string | null;
  paymentMethod: string | null;
  origin: string;
  soldAt: Date | null;
};

export type CreateSaleResult =
  | { ok: true; sale: CreatedSale; antiFraudFlagged: boolean }
  | { ok: false; status: number; error: string };

// Crea una venta (productos y/o servicios) de forma centralizada. Valida que
// cada ítem pertenezca a la tienda, calcula el total con el precio del catálogo
// y descuenta stock solo de productos. Devuelve un resultado tipado para que
// cada ruta decida cómo responder. Acepta una transacción opcional (`tx`):
// cuando se pasa, toda la escritura se hace dentro de ella para que el caller
// pueda commitear/rollbackear el conjunto (p. ej. cita → venta).
export async function createSale(
  input: CreateSaleInput,
  tx?: typeof db,
): Promise<CreateSaleResult> {
  // Sin transacción explícita, toda la venta (venta + ítems + stock + anti-
  // fraude) se escribe de forma atómica. Quien ya tiene una transacción abierta
  // (p. ej. confirmar un pedido) la pasa para que el commit sea conjunto.
  if (!tx) {
    return db.transaction((trx) => createSale(input, trx as unknown as typeof db));
  }
  const d = tx;
  const origin = input.origin ?? "manual";
  const storeId = input.storeId;

  const store = await d.query.stores.findFirst({ where: eq(stores.id, storeId) });
  if (!store) return { ok: false, status: 404, error: "Tienda no encontrada." };

  await refreshStoreStatus(store);
  if (!storeOperational(store)) {
    return {
      ok: false,
      status: 403,
      error:
        store.status === "BANNED"
          ? "La tienda fue vetada de la plataforma."
          : "La tienda está suspendida temporalmente; no puede registrar ventas hasta que termine la sanción.",
    };
  }

  if (!input.items.length) {
    return { ok: false, status: 400, error: "La venta necesita al menos un ítem." };
  }

  // Cantidades pedidas por producto (agregadas): evita validar dos veces el
  // mismo producto en líneas separadas y permite comparar contra el stock real.
  const requestedByProduct = new Map<string, number>();
  for (const item of input.items) {
    if (!item.productId && !item.serviceId) {
      return { ok: false, status: 400, error: "Cada ítem debe ser un producto o un servicio." };
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return { ok: false, status: 400, error: "La cantidad de cada ítem debe ser mayor que cero." };
    }
    if (item.productId) {
      const qty = Math.floor(item.quantity);
      if (qty < 1) return { ok: false, status: 400, error: "La cantidad de un producto debe ser un entero positivo." };
      requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + qty);
    }
  }

  // Precio y stock vigentes. `FOR UPDATE` bloquea las filas de los productos
  // implicados hasta el commit: dos ventas simultáneas del mismo producto se
  // serializan y la segunda ve el stock ya descontado (nunca se sobrevende).
  // El orden por id evita deadlocks entre ventas con varios productos.
  const productIds = [...requestedByProduct.keys()].sort();
  const productRows = productIds.length
    ? await (async () => {
        try {
          return await d
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
            .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
            .orderBy(products.id)
            .for("update");
        } catch {
          // Fallback si la DB aún no tiene las columnas de ofertas (deploy).
          return await d
            .select({
              id: products.id,
              name: products.name,
              price: products.price,
              available: products.available,
              stock: products.stock,
            })
            .from(products)
            .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
            .orderBy(products.id)
            .for("update");
        }
      })()
    : [];
  const productInfo = new Map(
    productRows.map((p) => [
      p.id,
      {
        name: p.name,
        stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
        available: p.available,
        price: withOfferFlags({
          price: p.price,
          offerPrice: (p as { offerPrice?: string | null }).offerPrice ?? null,
          offerEndsAt: (p as { offerEndsAt?: Date | string | null }).offerEndsAt ?? null,
        }).effectivePrice,
      },
    ]),
  );

  const serviceRows = await d.query.storeServices.findMany({
    where: eq(storeServices.storeId, storeId),
    columns: { id: true, price: true },
  });
  const servicePrice = new Map(serviceRows.map((s) => [s.id, Number(s.price)]));

  for (const item of input.items) {
    if (item.productId && !productInfo.has(item.productId)) {
      return { ok: false, status: 400, error: "El producto no pertenece a tu tienda o no existe." };
    }
    if (item.serviceId && !servicePrice.has(item.serviceId)) {
      return { ok: false, status: 400, error: "El servicio no pertenece a tu tienda o no existe." };
    }
  }

  // Un pedido del chat JAMÁS se confirma sin stock. Las ventas manuales se
  // permiten aunque el stock esté desactualizado: son una venta física que ya
  // ocurrió y no se puede rechazar; el stock se ajusta con GREATEST(0, …).
  if (origin === "order") {
    for (const [productId, qty] of requestedByProduct) {
      const p = productInfo.get(productId)!;
      if (!p.available) {
        return { ok: false, status: 409, error: `"${p.name}" ya no está disponible.` };
      }
      if (p.stock !== null && p.stock < qty) {
        return { ok: false, status: 409, error: `Solo quedan ${p.stock} de "${p.name}".` };
      }
    }
  }

  const total = input.items.reduce((acc, item) => {
    const unit = item.productId
      ? productInfo.get(item.productId)!.price
      : servicePrice.get(item.serviceId!)!;
    return acc + unit * item.quantity;
  }, 0);

  const paymentMethod = input.paymentMethod ?? null;

  const [sale] = await d
    .insert(sales)
    .values({
      storeId,
      total: String(total.toFixed(2)),
      note: input.note ?? null,
      customerId: input.customerId ?? null,
      paymentMethod,
      origin,
    })
    .returning();

  // ── Anti-fraude: venta inflada ──────────────────────────────────────────
  // Solo aplica a ventas autoregistradas por el comerciante (`manual`) sin un
  // método de pago rastreable. Un volumen alto en 24h puede ser inflación de
  // reputación (el check verificado solo cuenta ventas pagadas por
  // MP/WOMPI/CARD). No bloquea la operación: inserta la violación y el admin
  // decide. Las ventas de cita/pedido quedan excluidas porque tienen un cliente
  // real detrás (una agenda normal supera el umbral de 5/día sin problema).
  let antiFraudFlagged = false;
  if (
    origin === "manual" &&
    (!paymentMethod || !TRACKED_PAYMENT_METHODS.includes(paymentMethod))
  ) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [burst] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(sales)
      .where(
        and(
          eq(sales.storeId, storeId),
          eq(sales.origin, "manual"),
          gte(sales.soldAt, since),
        ),
      );
    if (Number(burst?.n ?? 0) >= INFLATED_SALE_DAY_BURST) {
      antiFraudFlagged = true;
      await insertViolation({
        type: "inflated_sale",
        severity: "warning",
        storeId,
        reason: `${Number(burst?.n ?? 0)} ventas autoregistradas en 24h sin método de pago rastreable (posible inflación de reputación).`,
        metadata: { salesIn24h: Number(burst?.n ?? 0), paymentMethod: paymentMethod ?? "ninguno" },
      });
    }
  }

  for (const item of input.items) {
    const unitPrice = item.productId
      ? productInfo.get(item.productId)!.price
      : servicePrice.get(item.serviceId!)!;

    await d.insert(saleItems).values({
      saleId: sale.id,
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      quantity: String(item.quantity),
      unitPrice: String(unitPrice.toFixed(2)),
    });

    if (item.productId) {
      // Descontar stock: al llegar a 0 (o menos) el producto se desactiva solo
      // en vez de eliminarse, manteniendo su histórico.
      await d
        .update(products)
        .set({ stock: sql`GREATEST(0, ${products.stock} - ${Math.floor(item.quantity)})` })
        .where(eq(products.id, item.productId));

      const [after] = await d
        .select({ stock: products.stock, name: products.name, storeId: products.storeId })
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      const left = after ? Number(after.stock) : NaN;
      if (after && Number.isFinite(left) && left <= 0) {
        await d
          .update(products)
          .set({ available: false })
          .where(eq(products.id, item.productId));
        // Avisar a la dueña: su producto se agotó solo (transición única).
        void notifyStockOut(storeId, item.productId, String(after.name ?? "Tu producto"));
      } else if (after && Number.isFinite(left) && left <= 5) {
        // Aviso diario de stock bajo (no cada venta).
        void notifyLowStock(storeId, item.productId, String(after.name ?? "Tu producto"), left);
      }
    }
  }

  return {
    ok: true,
    sale: {
      id: sale.id,
      storeId: sale.storeId,
      total: Number(sale.total),
      note: sale.note,
      customerId: sale.customerId,
      paymentMethod: sale.paymentMethod,
      origin: sale.origin,
      soldAt: sale.soldAt,
    },
    antiFraudFlagged,
  };
}

async function storeOwnerId(storeId: string): Promise<string | null> {
  const [s] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, storeId)).limit(1);
  return s?.ownerId ?? null;
}

/** Push a la dueña cuando un producto se agota solo (una vez por transición). */
async function notifyStockOut(storeId: string, productId: string, name: string): Promise<void> {
  try {
    const { notifyUser } = await import("./push");
    const ownerId = await storeOwnerId(storeId);
    if (!ownerId) return;
    await notifyUser(ownerId, {
      title: `Se agotó ${name.slice(0, 30)}`,
      body: "Lo desactivamos para no sobrevender. Súbele stock para reactivarlo.",
      data: { type: "stock_out", storeId, productId },
    });
  } catch {
    /* best-effort */
  }
}

/** Aviso diario (no por venta) cuando quedan ≤5 unidades. */
async function notifyLowStock(storeId: string, productId: string, name: string, left: number): Promise<void> {
  try {
    const { notifyUser, pushAllowedDaily } = await import("./push");
    if (!pushAllowedDaily(`lowstock:${storeId}:${productId}`)) return;
    const ownerId = await storeOwnerId(storeId);
    if (!ownerId) return;
    await notifyUser(ownerId, {
      title: `¡Solo quedan ${left} de ${name.slice(0, 30)}!`,
      body: "Súbele stock antes de que se agote solo.",
      data: { type: "stock_low", storeId, productId },
    });
  } catch {
    /* best-effort */
  }
}
