import { Router } from "express";
import { z } from "zod";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { db } from "../db/client";
import { products, stores } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProductLimit } from "../lib/prestige";
import { imageUrl } from "../lib/validators";
import { sanitizeAttributes, BusinessType } from "../lib/categoryFields";

const router = Router();

const attributesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  imageUrl: imageUrl().optional(),
  categoryId: z.string().uuid().optional(),
  stock: z.number().int().min(0).optional(),
  attributes: attributesSchema.optional(),
});

async function assertStoreOwner(storeId: string, userId: string) {
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return { ok: false as const, status: 404, msg: "Tienda no encontrada" };
  if (store.ownerId !== userId) return { ok: false as const, status: 403, msg: "No eres dueño de esta tienda" };
  return { ok: true as const, plan: store.plan, businessType: store.businessType as BusinessType };
}

// Publicar producto en una tienda
router.post("/stores/:storeId/products", requireAuth, async (req: AuthRequest, res) => {
  const check = await assertStoreOwner(req.params.storeId, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.msg });

  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Límite de productos según el plan (FREE=20, PRO=100, BUSINESS=500).
  const limit = getProductLimit(check.plan);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.storeId, req.params.storeId), eq(products.available, true)));
  if (count >= limit) {
    return res.status(403).json({
      error: `Alcanzaste el límite de ${limit} productos en tu plan actual.`,
    });
  }

  const [product] = await db
    .insert(products)
    .values({
      ...parsed.data,
      price: parsed.data.price.toFixed(2),
      stock: String(parsed.data.stock ?? 0),
      attributes: sanitizeAttributes(check.businessType, parsed.data.attributes),
      storeId: req.params.storeId,
    })
    .returning();

  res.status(201).json(product);
});

// Actualizar / dar de baja producto
router.patch("/products/:id", requireAuth, async (req: AuthRequest, res) => {
  const [product] = await db.select().from(products).where(eq(products.id, req.params.id)).limit(1);
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const check = await assertStoreOwner(product.storeId, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.msg });

  const patch: Record<string, unknown> = { ...req.body };
  if (typeof patch.price === "number") patch.price = patch.price.toFixed(2);
  if (patch.attributes !== undefined) {
    patch.attributes = sanitizeAttributes(check.businessType, patch.attributes as Record<string, unknown>);
  }

  // Regla de stock: si el stock llega a 0 el producto se desactiva solo
  // (en vez de eliminarlo). Si vuelve a tener stock > 0, se reactiva.
  if (patch.stock !== undefined) {
    const stock = Math.max(0, Math.floor(Number(patch.stock) || 0));
    patch.stock = String(stock);
    patch.available = stock > 0;
  }

  const [updated] = await db
    .update(products)
    .set(patch)
    .where(eq(products.id, product.id))
    .returning();

  res.json(updated);
});

// Registrar una vista a un producto (para "Productos más vistos")
router.post("/products/:id/views", async (req, res) => {
  await db
    .update(products)
    .set({ views: sql`${products.views} + 1` })
    .where(eq(products.id, req.params.id));
  res.status(204).end();
});

// Búsqueda / tendencias de productos (across todas las tiendas)
router.get("/products", async (req, res) => {
  const q = (req.query.q as string) || "";
  const take = Math.min(Number(req.query.take) || 20, 50);

  const results = await db.query.products.findMany({
    where: and(eq(products.available, true), ilike(products.name, `%${q}%`)),
    limit: take,
    orderBy: [desc(products.createdAt)],
    columns: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      available: true,
      views: true,
      createdAt: true,
      storeId: true,
      categoryId: true,
    },
    with: {
      store: { columns: { name: true, slug: true, logoUrl: true } },
    },
  });

  res.json(results);
});

export default router;
