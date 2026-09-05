import { Router } from "express";
import { z } from "zod";
import { eq, and, ilike, desc } from "drizzle-orm";
import { db } from "../db/client";
import { products, stores } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  imageUrl: z.string().url().optional(),
  categoryId: z.string().uuid().optional(),
});

async function assertStoreOwner(storeId: string, userId: string) {
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return { ok: false as const, status: 404, msg: "Tienda no encontrada" };
  if (store.ownerId !== userId) return { ok: false as const, status: 403, msg: "No eres dueño de esta tienda" };
  return { ok: true as const };
}

// Publicar producto en una tienda
router.post("/stores/:storeId/products", requireAuth, async (req: AuthRequest, res) => {
  const check = await assertStoreOwner(req.params.storeId, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.msg });

  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [product] = await db
    .insert(products)
    .values({
      ...parsed.data,
      price: parsed.data.price.toFixed(2),
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

  const [updated] = await db
    .update(products)
    .set(patch)
    .where(eq(products.id, product.id))
    .returning();

  res.json(updated);
});

// Búsqueda / tendencias de productos (across todas las tiendas)
router.get("/products", async (req, res) => {
  const q = (req.query.q as string) || "";
  const take = Math.min(Number(req.query.take) || 20, 50);

  const results = await db.query.products.findMany({
    where: and(eq(products.available, true), ilike(products.name, `%${q}%`)),
    limit: take,
    orderBy: [desc(products.createdAt)],
    with: {
      store: { columns: { name: true, slug: true, logoUrl: true } },
    },
  });

  res.json(results);
});

export default router;
