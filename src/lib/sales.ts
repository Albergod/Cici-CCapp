import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { products, sales, saleItems, storeServices, stores } from "../db/schema";
import {
  INFLATED_SALE_DAY_BURST,
  TRACKED_PAYMENT_METHODS,
  insertViolation,
  refreshStoreStatus,
  storeOperational,
} from "./moderation";

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
  const d = tx ?? db;
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

  const productRows = await d.query.products.findMany({
    where: eq(products.storeId, storeId),
    columns: { id: true, price: true },
  });
  const productPrice = new Map(productRows.map((p) => [p.id, Number(p.price)]));

  const serviceRows = await d.query.storeServices.findMany({
    where: eq(storeServices.storeId, storeId),
    columns: { id: true, price: true },
  });
  const servicePrice = new Map(serviceRows.map((s) => [s.id, Number(s.price)]));

  for (const item of input.items) {
    if (!item.productId && !item.serviceId) {
      return { ok: false, status: 400, error: "Cada ítem debe ser un producto o un servicio." };
    }
    if (item.productId && !productPrice.has(item.productId)) {
      return { ok: false, status: 400, error: "El producto no pertenece a tu tienda o no existe." };
    }
    if (item.serviceId && !servicePrice.has(item.serviceId)) {
      return { ok: false, status: 400, error: "El servicio no pertenece a tu tienda o no existe." };
    }
  }

  const total = input.items.reduce((acc, item) => {
    const unit = item.productId
      ? productPrice.get(item.productId)!
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
      ? productPrice.get(item.productId)!
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
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      if (after && Number(after.stock) <= 0) {
        await d
          .update(products)
          .set({ available: false })
          .where(eq(products.id, item.productId));
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
