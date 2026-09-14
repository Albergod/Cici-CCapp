import { Router } from "express";
import { z } from "zod";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { db } from "../db/client";
import { stores, products, sales, saleItems } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  storeOperational,
  refreshStoreStatus,
  insertViolation,
  TRACKED_PAYMENT_METHODS,
  INFLATED_SALE_DAY_BURST,
} from "../lib/moderation";

const router = Router();

async function getOwnStore(userId: string): Promise<string | null> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.ownerId, userId),
    columns: { id: true },
  });
  return store?.id ?? null;
}

// Registrar una venta manual (una o más líneas de producto)
const registerSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
  note: z.string().optional(),
  customerId: z.string().optional(),
  paymentMethod: z.enum(["EFECTIVO", "TRANSFERENCIA", "CARD", "MP", "WOMPI"]).optional(),
});

router.post("/sales", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db
    .select()
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(403).json({ error: "No tienes una tienda propia." });

  // Anti-fraude: una tienda suspendida o baneada no puede registrar ventas
  // (evita que inflen su reputación mientras están sancionadas).
  await refreshStoreStatus(store);
  if (!storeOperational(store)) {
    return res.status(403).json({
      error:
        store.status === "BANNED"
          ? "Tu tienda fue vetada de la plataforma."
          : "Tu tienda está suspendida temporalmente; no puedes registrar ventas hasta que termine la sanción.",
    });
  }

  const parsed = registerSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const storeId = store.id;

  // Verificar que todos los productos pertenezcan a esta tienda
  const productsDb = await db.query.products.findMany({
    where: eq(products.storeId, storeId),
    columns: { id: true, price: true, stock: true },
  });
  const priceMap = new Map(productsDb.map((p) => [p.id, Number(p.price)]));

  for (const item of parsed.data.items) {
    if (!priceMap.has(item.productId)) {
      return res
        .status(400)
        .json({ error: `El producto no pertenece a tu tienda o no existe.` });
    }
  }

  const total = parsed.data.items.reduce(
    (acc, item) => acc + priceMap.get(item.productId)! * item.quantity,
    0,
  );

  const paymentMethod = parsed.data.paymentMethod ?? null;

  const [sale] = await db
    .insert(sales)
    .values({
      storeId,
      total: String(total.toFixed(2)),
      note: parsed.data.note,
      customerId: parsed.data.customerId,
      paymentMethod,
    })
    .returning();

  // ── Anti-fraude: venta inflada ──────────────────────────────────────────
  // Un volumen alto de ventas autoregistradas SIN un método de pago
  // rastreable en 24h huele a inflación de reputación (el check verificado
  // solo cuenta ventas pagadas por MP/WOMPI/CARD). Se registra la violación
  // para que el admin decida; no bloquea la operación de la tienda.
  let antiFraudFlagged = false;
  if (!paymentMethod || !TRACKED_PAYMENT_METHODS.includes(paymentMethod)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [burst] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sales)
      .where(and(eq(sales.storeId, storeId), gte(sales.soldAt, since)));
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

  for (const item of parsed.data.items) {
    await db.insert(saleItems).values({
      saleId: sale.id,
      productId: item.productId,
      quantity: String(item.quantity),
      unitPrice: String(priceMap.get(item.productId)!.toFixed(2)),
    });

    // Descontar stock: al llegar a 0 (o menos) el producto se desactiva solo
    // en vez de eliminarse, manteniendo su histórico.
    await db
      .update(products)
      .set({
        stock: sql`GREATEST(0, ${products.stock} - ${Math.floor(item.quantity)})`,
      })
      .where(eq(products.id, item.productId));

    const [after] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, item.productId))
      .limit(1);
    if (after && Number(after.stock) <= 0) {
      await db
        .update(products)
        .set({ available: false })
        .where(eq(products.id, item.productId));
    }
  }

  res.status(201).json({ ...sale, total: Number(sale.total), antiFraudFlagged });
});

// Estadísticas del negocio + ventas recientes
router.get("/sales/stats", requireAuth, async (req: AuthRequest, res) => {
  const storeId = await getOwnStore(req.userId!);
  if (!storeId) return res.status(403).json({ error: "No tienes una tienda propia." });

  const productsDb = await db.query.products.findMany({
    where: eq(products.storeId, storeId),
    columns: { id: true, name: true, price: true, views: true },
  });

  const allSales = await db.query.sales.findMany({
    where: eq(sales.storeId, storeId),
    with: {
      items: { with: { product: { columns: { id: true, name: true } } } },
      customer: { columns: { id: true, name: true } },
    },
    orderBy: (s, { desc }) => [desc(s.soldAt)],
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const todaySales = allSales.filter((s) => {
    if (!s.soldAt) return false;
    return new Date(s.soldAt).getTime() >= startOfToday.getTime();
  });

  const avg = (arr: saleWithItems[]) =>
    arr.reduce((acc, s) => acc + Number(s.total), 0);

  const totalSales = allSales.length;
  const totalRevenue = avg(allSales);
  const todayCount = todaySales.length;
  const todayRevenue = avg(todaySales);

  // Clientes distintos que han comprado
  const customerCount = new Set(
    allSales.filter((s) => s.customerId).map((s) => s.customerId),
  ).size;

  // Productos más vendidos
  const soldMap = new Map<
    string,
    { name: string; quantity: number; productId: string }
  >();
  for (const s of allSales) {
    for (const item of s.items) {
      const key = item.productId ?? item.product?.name ?? "—";
      const qty = Number(item.quantity) || 0;
      if (soldMap.has(key)) {
        soldMap.get(key)!.quantity += qty;
      } else {
        soldMap.set(key, {
          name: item.product?.name ?? "Producto",
          quantity: qty,
          productId: item.productId ?? "",
        });
      }
    }
  }
  const topProducts = [...soldMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Productos más vistos (según el contador views)
  const topViewed = [...productsDb]
    .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
    .slice(0, 5)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      views: Number(p.views || 0),
    }));

  // Tasa de conversión: ventas / vistas a productos (todas las vistas sumadas).
  // Si nadie ha visto productos, mostramos 0 para no dividir entre cero.
  const totalViews = productsDb.reduce((acc, p) => acc + Number(p.views || 0), 0);
  const conversionRate = totalViews > 0 ? totalSales / totalViews : 0;

  // Ventas recientes para la tabla (más recientes primero)
  const recentSales = allSales.slice(0, 20).map((s) => ({
    id: s.id,
    total: Number(s.total),
    soldAt: s.soldAt,
    note: s.note,
    customerName: s.customer?.name ?? null,
    itemsSummary: s.items.map((i) => ({
      name: i.product?.name ?? "Producto",
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
    })),
  }));

  res.json({
    totalSales,
    totalRevenue,
    todayCount,
    todayRevenue,
    customerCount,
    topProducts,
    topViewed,
    conversionRate,
    totalViews,
    recentSales,
    productCount: productsDb.length,
  });
});

type saleWithItems = {
  id: string;
  total: number | string;
  soldAt: Date | null;
  note: string | null;
  customerId: string | null;
  items: {
    productId: string | null;
    product?: { id: string; name: string } | null;
    quantity: string;
    unitPrice: string;
  }[];
  customer?: { id: string; name: string } | null;
};

export default router;