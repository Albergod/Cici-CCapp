import { Router } from "express";
import { z } from "zod";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { db } from "../db/client";
import { stores, follows, users, products, mpPayments } from "../db/schema";
import { requireAuth, optionalAuth, AuthRequest } from "../middleware/auth";
import { getContactEligibility } from "../lib/subscription";
import { imageUrl } from "../lib/validators";
import {
  PRESTIGE_PER_REFERRAL,
  getProductLimit,
  computePrestigeStatus,
} from "../lib/prestige";

const router = Router();

// ── Downgrade de tiendas vencidas ─────────────────────────────────────────────
// Ejecuta periodicamente (ej. vía cron de Railway o Cloudflare) para bajar a
// FREE las tiendas cuyo subscriptionExpiresAt pasó.  IMPORTANTE: este endpoint
// NO está protegido para el público. Usa ADMIN_TOKEN o encrírrelo tras proxy.
async function expireStoresAndReturnCount(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(stores)
    .set({ plan: "FREE", subscriptionCycle: null, subscriptionExpiresAt: null })
    .where(
      and(
        sql`subscription_expires_at < '${now.toISOString()}'`,
        eq(stores.plan, sql`"PRO"`),
      ),
    )
    .returning({ id: stores.id });
  return result.length;
}

router.post("/admin/expire-stores", async (_req: AuthRequest, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(503).json({ error: "Admin endpoint deshabilitado" });
  }
  const provided = _req.headers["x-admin-token"];
  if (provided !== adminToken) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const updated = await expireStoresAndReturnCount();
    res.json({ ok: true as const, expiredCount: updated });
  } catch (e) {
    console.error("expire stores error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

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
  logoUrl: imageUrl().optional(),
  bannerUrl: imageUrl().optional(),
  whatsapp: z.string().max(20).optional(),
  businessType: z.enum(["ROPA", "CALZADO", "ACCESORIOS", "HOGAR", "ALIMENTOS", "SERVICIOS", "OTRO"]).optional(),
});

// Crear tienda ("abrir tu local").
// IMPORTANTE: las tiendas se crean SIEMPRE en plan FREE. Un plan de pago
// (PRO/BUSINESS) solo se activa cuando un pago real es aprobado por Mercado
// Pago (ver routes/payments.routes.ts → activatePaidPlan). Así, jamás se
// concede premium sin que el pago haya sido confirmado.
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = createStoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const baseSlug = slugify(parsed.data.name);
  let slug = baseSlug;
  let i = 1;
  while ((await db.select().from(stores).where(eq(stores.slug, slug)).limit(1)).length > 0) {
    slug = `${baseSlug}-${i++}`;
  }

  // El sistema de prestigio y el código de referido se generan al activar un
  // plan de pago (no al crear la tienda gratuita).

  // Si el creador llegó con un código de referido, asociar la tienda al
  // referidor (este gana prestigio solo si tiene un plan de pago activo).
  const [creator] = await db
    .select({ refCode: users.refCode })
    .from(users)
    .where(eq(users.id, req.userId!))
    .limit(1);

  let referredByStoreId: string | null = null;
  if (creator?.refCode) {
    const referrer = await db
      .select({ id: stores.id, plan: stores.plan })
      .from(stores)
      .where(eq(stores.referralCode, creator.refCode))
      .limit(1);
    if (referrer.length > 0 && referrer[0].plan !== "FREE") {
      referredByStoreId = referrer[0].id;
      await db
        .update(stores)
        .set({ prestigePoints: sql`${stores.prestigePoints} + ${PRESTIGE_PER_REFERRAL}` })
        .where(eq(stores.id, referredByStoreId));
    }
  }

  const [store] = await db
    .insert(stores)
    .values({
      ...parsed.data,
      plan: "FREE",
      slug,
      referredByStoreId,
      ownerId: req.userId!,
    })
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
    // Orden de prioridad en el centro comercial: los locales con plan de pago
    // (BUSINESS y PRO) se muestran primero; luego los FREE. Dentro del mismo
    // nivel, los más recientes primero.
    orderBy: (s, { desc }) => [
      sql`CASE WHEN ${s.plan} = 'BUSINESS' THEN 0 WHEN ${s.plan} = 'PRO' THEN 1 ELSE 2 END`,
      desc(s.createdAt),
    ],
    with: { followers: true, products: true },
  });

  const withCounts = results.map(({ followers, products, referralCode: _rc, referredByStoreId: _rbid, ...store }) => {
    const elig = getContactEligibility(
      store.trialStartedAt,
      store.subscriptionExpiresAt,
    );
    const prestige = Number(store.prestigePoints) || 0;
    const prestigeActive = store.plan !== "FREE";
    return {
      ...store,
      followersCount: followers.length,
      productsCount: products.length,
      contactAvailable: elig.contactAvailable,
      subscriptionStatus: elig.status,
      prestigePoints: prestige,
      prestigeActive,
      verified:
        prestigeActive && computePrestigeStatus(prestige) === "verified",
    };
  });

  res.json(withCounts);
});

// Referido del negocio: devuelve el enlace y los puntos del emprendedor autenticado.
// El sistema de prestigio SOLO está activo para tiendas con plan de pago.
router.get("/referral", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      referralCode: stores.referralCode,
      prestigePoints: stores.prestigePoints,
      plan: stores.plan,
    })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const prestige = Number(store.prestigePoints) || 0;
  const prestigeActive = store.plan !== "FREE";

  if (!prestigeActive) {
    return res.json({
      active: false,
      message:
        "El sistema de prestigio se activa al elegir un plan de pago. Invita a otros emprendedores y gana el check verificado.",
      prestigePoints: 0,
      required: 100,
      verified: false,
      productLimit: getProductLimit(store.plan),
    });
  }

  res.json({
    active: true,
    referralCode: store.referralCode,
    referralLink: `${req.protocol}://${req.get("host")}/register?ref=${store.referralCode}`,
    prestigePoints: prestige,
    required: 100,
    verified: computePrestigeStatus(prestige) === "verified",
    productLimit: getProductLimit(store.plan),
  });
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

// Actualizar perfil de la tienda (personalización: nombre, descripción, logo y portada).
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(2).optional(),
      description: z.string().optional(),
      logoUrl: imageUrl().optional().or(z.literal("")),
      bannerUrl: imageUrl().optional().or(z.literal("")),
      whatsapp: z.string().max(20).optional(),
      businessType: z.enum(["ROPA", "CALZADO", "ACCESORIOS", "HOGAR", "ALIMENTOS", "SERVICIOS", "OTRO"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, req.params.id), eq(stores.ownerId, req.userId!)))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada." });

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    const baseSlug = slugify(parsed.data.name);
    let slug = baseSlug;
    let i = 1;
    for (;;) {
      const existing = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.slug, slug))
        .limit(1);
      if (existing.length === 0 || existing[0].id === store.id) break;
      slug = `${baseSlug}-${i++}`;
    }
    patch.name = parsed.data.name;
    patch.slug = slug;
  }
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
  if (parsed.data.logoUrl !== undefined) patch.logoUrl = parsed.data.logoUrl || null;
  if (parsed.data.bannerUrl !== undefined) patch.bannerUrl = parsed.data.bannerUrl || null;
  if (parsed.data.whatsapp !== undefined) patch.whatsapp = parsed.data.whatsapp || null;
  if (parsed.data.businessType !== undefined) patch.businessType = parsed.data.businessType;

  const [updated] = await db
    .update(stores)
    .set(patch)
    .where(eq(stores.id, store.id))
    .returning();

  res.json(updated);
});

// Perfil de una tienda ("canal") por slug
router.get("/:slug", optionalAuth, async (req: AuthRequest, res) => {
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.slug, req.params.slug),
    with: {
      products: {
        where: (p, { eq: eqOp }) => eqOp(p.available, true),
        columns: {
          id: true,
          name: true,
          description: true,
          price: true,
          imageUrl: true,
          available: true,
          createdAt: true,
          storeId: true,
          categoryId: true,
        },
      },
      categories: true,
      followers: true,
    },
  });
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  // Si el visitante es el dueño, le mostramos el stock de cada producto
  // (para su panel); el público nunca ve el stock.
  const isOwner = req.userId ? store.ownerId === req.userId : false;
  const visibleProducts = isOwner
    ? await db.query.products.findMany({
        where: eq(products.storeId, store.id),
        orderBy: (p, { asc }) => [asc(p.createdAt)],
      })
    : store.products;

  const {
    followers,
    products: _ignored,
    referralCode: _rc,
    referredByStoreId: _rbid,
    ...rest
  } = store;
  const elig = getContactEligibility(
    store.trialStartedAt,
    store.subscriptionExpiresAt,
  );
  const prestige = Number(store.prestigePoints) || 0;
  const prestigeActive = store.plan !== "FREE";
  res.json({
    ...rest,
    products: visibleProducts,
    followersCount: followers.length,
    contactAvailable: elig.contactAvailable,
    subscriptionStatus: elig.status,
    trialEndsAt: elig.trialEndsAt,
    prestigePoints: prestige,
    prestigeActive,
    verified:
      prestigeActive && computePrestigeStatus(prestige) === "verified",
    following: req.userId
      ? followers.some((f) => f.userId === req.userId)
      : false,
  });
});

// Cambiar / actualizar el ciclo del espacio (arriendo).
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

// ── Admin: Stats del panel ─────────────────────────────────────────────
// GET /api/admin/stats
// Header: X-Admin-Token (valor de ADMIN_TOKEN en .env)
const requireAdmin = (req: AuthRequest, res: any, next: any) => {
  if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "Token de administrador inválido" });
  }
  next();
};

router.get("/admin/stats", requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const [totalStores] = await db.select({ c: count(stores.id) }).from(stores);
    const [totalFree] = await db.select({ c: count(stores.id) }).from(stores).where(eq(stores.plan, "FREE"));
    const [totalPro] = await db.select({ c: count(stores.id) }).from(stores).where(eq(stores.plan, "PRO"));
    const [totalBusiness] = await db.select({ c: count(stores.id) }).from(stores).where(eq(stores.plan, "BUSINESS"));
    const [totalPayments] = await db.select({ c: count(mpPayments.id) }).from(mpPayments);
    const [recentPayments] = await db
      .select({
        id: mpPayments.id,
        status: mpPayments.status,
        plan: mpPayments.plan,
        amount: mpPayments.amount,
        processedAt: mpPayments.processedAt,
      })
      .from(mpPayments)
      .orderBy(desc(mpPayments.processedAt))
      .limit(10);

    res.json({
      totalStores: Number(totalStores.c),
      totalFree: Number(totalFree.c),
      totalPro: Number(totalPro.c),
      totalBusiness: Number(totalBusiness.c),
      totalPayments: Number(totalPayments.c),
      recentPayments,
    });
  } catch (err) {
    console.error("admin stats error:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// ── Admin: Lista de pagos recientes ────────────────────────────────────
// GET /api/admin/payments
router.get("/admin/payments", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [countResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(mpPayments);
    const total = Number(countResult.total);

    const rows = await db
      .select({
        id: mpPayments.id,
        storeId: mpPayments.storeId,
        status: mpPayments.status,
        plan: mpPayments.plan,
        cycle: mpPayments.cycle,
        amount: mpPayments.amount,
        processedAt: mpPayments.processedAt,
      })
      .from(mpPayments)
      .orderBy(desc(mpPayments.processedAt))
      .limit(limit)
      .offset(offset);

    res.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("admin payments error:", err);
    res.status(500).json({ error: "Error al obtener pagos" });
  }
});

export default router;
