import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { stores, follows } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getContactEligibility } from "../lib/subscription";

const router = Router();

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const createStoreSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  subscriptionCycle: z.enum(["MONTHLY", "BI_MONTHLY"]).optional(),
});

// Crear tienda ("abrir tu local")
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = createStoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const baseSlug = slugify(parsed.data.name);
  let slug = baseSlug;
  let i = 1;
  while ((await db.select().from(stores).where(eq(stores.slug, slug)).limit(1)).length > 0) {
    slug = `${baseSlug}-${i++}`;
  }

  const [store] = await db
    .insert(stores)
    .values({ ...parsed.data, slug, ownerId: req.userId! })
    .returning();

  res.status(201).json(store);
});

// Feed / explorar tiendas destacadas (paginado simple)
router.get("/", async (req, res) => {
  const take = Math.min(Number(req.query.take) || 20, 50);
  const skip = Number(req.query.skip) || 0;

  const results = await db.query.stores.findMany({
    limit: take,
    offset: skip,
    orderBy: (s, { desc }) => [desc(s.createdAt)],
    with: { followers: true, products: true },
  });

  const withCounts = results.map(({ followers, products, ...store }) => {
    const elig = getContactEligibility(
      store.trialStartedAt,
      store.subscriptionExpiresAt,
    );
    return {
      ...store,
      followersCount: followers.length,
      productsCount: products.length,
      contactAvailable: elig.contactAvailable,
      subscriptionStatus: elig.status,
    };
  });

  res.json(withCounts);
});

// Tiendas que sigue el usuario autenticado (para la barra lateral)
router.get("/following", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db.query.follows.findMany({
    where: eq(follows.userId, req.userId!),
    with: {
      store: {
        columns: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          plan: true,
        },
      },
    },
    orderBy: (f, { desc }) => [desc(f.createdAt)],
  });

  res.json(rows.map((r) => r.store));
});

// Perfil de una tienda ("canal") por slug
router.get("/:slug", async (req, res) => {
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.slug, req.params.slug),
    with: {
      products: { where: (p, { eq: eqOp }) => eqOp(p.available, true) },
      categories: true,
      followers: true,
    },
  });
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  const { followers, ...rest } = store;
  const elig = getContactEligibility(
    store.trialStartedAt,
    store.subscriptionExpiresAt,
  );
  res.json({
    ...rest,
    followersCount: followers.length,
    contactAvailable: elig.contactAvailable,
    subscriptionStatus: elig.status,
    trialEndsAt: elig.trialEndsAt,
  });
});

// Elegir / actualizar el espacio (ciclo de arriendo). El pago real se hace más adelante.
router.patch("/:id/space", requireAuth, async (req: AuthRequest, res) => {
  const cycle = z.enum(["MONTHLY", "BI_MONTHLY"]).optional().safeParse(req.body?.subscriptionCycle);
  if (!cycle.success) {
    return res.status(400).json({ error: "Ciclo de espacio inválido." });
  }

  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, req.params.id), eq(stores.ownerId, req.userId!)))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada." });

  const [updated] = await db
    .update(stores)
    .set({ subscriptionCycle: cycle.data ?? null })
    .where(eq(stores.id, store.id))
    .returning();

  res.json(updated);
});

// Seguir / dejar de seguir una tienda
router.post("/:id/follow", requireAuth, async (req: AuthRequest, res) => {
  const storeId = req.params.id;

  const [existing] = await db
    .select()
    .from(follows)
    .where(and(eq(follows.userId, req.userId!), eq(follows.storeId, storeId)))
    .limit(1);

  if (existing) {
    await db.delete(follows).where(eq(follows.id, existing.id));
    return res.json({ following: false });
  }

  await db.insert(follows).values({ userId: req.userId!, storeId });
  res.json({ following: true });
});

export default router;
