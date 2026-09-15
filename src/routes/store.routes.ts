import { Router } from "express";
import { z } from "zod";
import { eq, and, sql, desc, count, isNull, lt, ne, isNotNull, inArray, gte } from "drizzle-orm";
import { db } from "../db/client";
import { stores, follows, users, products, mpPayments, violations } from "../db/schema";
import { requireAuth, optionalAuth, AuthRequest } from "../middleware/auth";
import { getContactEligibility } from "../lib/subscription";
import { imageUrl } from "../lib/validators";
import {
  awardReferralPrestige,
  getProductLimit,
  VERIFIED_THRESHOLD,
} from "../lib/prestige";
import { activatePaidPlan } from "../lib/plans";
import {
  getTrackedSalesCounts,
  isStoreVerified,
  reauthorizeExpiredSuspensions,
  storeOperational,
  refreshStoreStatus,
  insertViolation,
  applySuspension,
  banStore,
  REFERRAL_BURST_LIMIT,
  SUSPENSION_REPORT_FLAGS,
  BAN_REPORT_FLAGS,
  SUSPENSION_REPORTS_DAYS,
} from "../lib/moderation";

const router = Router();

// ── Downgrade automático de tiendas vencidas ─────────────────────────────────
// Baja a FREE las tiendas (PRO Y BUSINESS) cuyo subscriptionExpiresAt pasó.
// Se dispara en cada arranque y luego por un cron interno (index.ts), además
// del endpoint /admin/expire-stores (protegido con ADMIN_TOKEN) para forzarlo.
// Idempotente: una tienda ya FREE nunca vuelve a pasar por aquí.
export async function expireStoresAndReturnCount(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(stores)
    .set({ plan: "FREE", subscriptionCycle: null, subscriptionExpiresAt: null })
    .where(
      and(
        lt(stores.subscriptionExpiresAt, now),
        isNotNull(stores.subscriptionExpiresAt),
        ne(stores.plan, "FREE"),
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
// Las tiendas se crean SIEMPRE en plan FREE. Un plan de pago (PRO/BUSINESS)
// solo se activa cuando un pago real es aprobado (ver payments/wompi). Si el
// comerciante ya pagó su plan ANTES de crear la tienda (pago sin storeId, fila
// approved con store_id NULL), ese plan se aplica aquí a la tienda recién
// creada. Así SIEMPRE: sin pago aprobado jamás se concede premium.
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = createStoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Un usuario = una tienda. Si ya tiene una, se rechaza la creación.
  const [existingStore] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (existingStore) {
    return res.status(409).json({ error: "Ya tienes una tienda. Cada usuario solo puede tener una." });
  }

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
    .select({ refCode: users.refCode, signupIp: users.signupIp })
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
      // Anti-fraude: granja de referidos. Si desde UNA misma IP se abrieron más
      // de REFERRAL_BURST_LIMIT tiendas con este código en 24h, no se premia:
      // se registra la violación para que el admin la revise.
      let farmed = false;
      const ip = creator.signupIp;
      if (ip) {
        const [burst] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(stores)
          .innerJoin(users, eq(stores.ownerId, users.id))
          .where(
            and(
              eq(users.refCode, creator.refCode),
              eq(users.signupIp, ip),
              gte(stores.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
            ),
          );
        if (Number(burst?.n ?? 0) + 1 > REFERRAL_BURST_LIMIT) {
          farmed = true;
          await insertViolation({
            type: "referral_farm",
            severity: "warning",
            storeId: referrer[0].id,
            userId: req.userId!,
            reason: `Posible granja de referidos: ${Number(burst?.n ?? 0) + 1} tiendas creadas con tu código desde la IP ${ip} en 24h`,
            metadata: { ip, burstCount: Number(burst?.n ?? 0) + 1 },
          });
        }
      }
      if (!farmed) {
        // La referencia queda guardada, pero el prestigio NO se otorga acá:
        // solo cuando la tienda del referido activa un plan de pago
        // (awardReferralPrestige). Un referido que crea su tienda FREE no
        // genera puntos.
        referredByStoreId = referrer[0].id;
      }
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

  // Si el comerciante ya pagó su plan (pago aprobado sin tienda asociada),
  // activamos ese plan en la tienda recién creada y ligamos el pago a ella.
  const [paid] = await db
    .select()
    .from(mpPayments)
    .where(
      and(
        eq(mpPayments.userId, req.userId!),
        isNull(mpPayments.storeId),
        eq(mpPayments.status, "approved"),
      ),
    )
    .limit(1);

  if (paid) {
    try {
      await activatePaidPlan(store.id, paid.plan as "PRO" | "BUSINESS", paid.cycle as "MONTHLY" | "BI_MONTHLY");
      // El referido pagó su plan → el referidor (si tiene plan activo) gana prestigio.
      await awardReferralPrestige(store.id);
      await db
        .update(mpPayments)
        .set({ storeId: store.id })
        .where(eq(mpPayments.id, paid.id));
      const [updated] = await db.select().from(stores).where(eq(stores.id, store.id)).limit(1);
      return res.status(201).json(updated ?? store);
    } catch (err) {
      console.error("aplicar plan pagado al crear la tienda:", err);
    }
  }

  res.status(201).json(store);
});

// Feed / explorar tiendas destacadas (paginado simple)
router.get("/", async (req, res) => {
  const take = Math.min(Number(req.query.take) || 20, 50);
  const skip = Number(req.query.skip) || 0;

  // Reactivar tiendas suspendidas cuya sanción ya expiró (revisión lazy).
  await reauthorizeExpiredSuspensions();

  const results = await db.query.stores.findMany({
    limit: take,
    offset: skip,
    // Solo tiendas activas: las suspendidas/banneadas no aparecen en el mall.
    where: (s, { eq: eqOp }) => eqOp(s.status, "ACTIVE"),
    // Orden de prioridad en el centro comercial: los locales con plan de pago
    // (BUSINESS y PRO) se muestran primero; luego los FREE. Dentro del mismo
    // nivel, los más recientes primero.
    orderBy: (s, { desc }) => [
      sql`CASE WHEN ${s.plan} = 'BUSINESS' THEN 0 WHEN ${s.plan} = 'PRO' THEN 1 ELSE 2 END`,
      desc(s.createdAt),
    ],
    with: { followers: true, products: true },
  });

  // Ventas reales (medios rastreables) de la página completa en una query.
  const trackedSales = await getTrackedSalesCounts(results.map((r) => r.id));

  // Concede el check "sticky" a las tiendas que ya cumplen y aún no lo tienen.
  const eligible = results.filter(
    (s) =>
      s.verifiedAt === null &&
      isStoreVerified({
        prestigeActive: s.plan !== "FREE",
        prestigePoints: s.prestigePoints,
        prestigeGoal: s.prestigeGoal,
        createdAt: s.createdAt,
        trackedSales: trackedSales.get(s.id) ?? 0,
      }),
  );
  if (eligible.length) {
    await db
      .update(stores)
      .set({ verifiedAt: new Date() })
      .where(and(inArray(stores.id, eligible.map((s) => s.id)), isNull(stores.verifiedAt)));
  }

  const withCounts = results.map(({ followers, products, referralCode: _rc, referredByStoreId: _rbid, ...store }) => {
    const elig = getContactEligibility(
      store.trialStartedAt,
      store.subscriptionExpiresAt,
      store.plan,
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
      prestigeGoal: store.prestigeGoal,
      verified: store.verifiedAt !== null,
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
      prestigeGoal: stores.prestigeGoal,
      verifiedAt: stores.verifiedAt,
      plan: stores.plan,
      createdAt: stores.createdAt,
    })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const prestige = Number(store.prestigePoints) || 0;
  const prestigeActive = store.plan !== "FREE";
  const goal = Number(store.prestigeGoal) || VERIFIED_THRESHOLD;

  if (!prestigeActive) {
    return res.json({
      active: false,
      message:
        "El sistema de prestigio se activa al elegir un plan de pago. Invita a otros emprendedores y gana el check verificado.",
      prestigePoints: 0,
      required: goal,
      verified: false,
      productLimit: getProductLimit(store.plan),
    });
  }

  const trackedMap = await getTrackedSalesCounts([store.id]);

  // Check "sticky": conceder la primera vez que cumple, no se pierde nunca.
  let justGranted = false;
  if (
    store.verifiedAt === null &&
    isStoreVerified({
      prestigeActive,
      prestigePoints: prestige,
      prestigeGoal: goal,
      createdAt: store.createdAt,
      trackedSales: trackedMap.get(store.id) ?? 0,
    })
  ) {
    justGranted = true;
    await db
      .update(stores)
      .set({ verifiedAt: new Date() })
      .where(and(eq(stores.id, store.id), isNull(stores.verifiedAt)));
  }

  res.json({
    active: true,
    referralCode: store.referralCode,
    referralLink: `${req.protocol}://${req.get("host")}/register?ref=${store.referralCode}`,
    prestigePoints: prestige,
    prestigeGoal: goal,
    required: goal,
    verified: store.verifiedAt !== null || justGranted,
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
          attributes: true,
        },
      },
      categories: true,
      followers: true,
    },
  });
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  // Anti-fraude: una tienda suspendida/banneada no se muestra al público.
  // El dueño sí puede entrar para ver su estado y el motivo de la sanción.
  const isOwner = req.userId ? store.ownerId === req.userId : false;
  if (!isOwner) {
    await refreshStoreStatus(store);
    if (!storeOperational(store)) {
      return res.status(404).json({ error: "Tienda no encontrada" });
    }
  }

  // Si el visitante es el dueño, le mostramos el stock de cada producto
  // (para su panel); el público nunca ve el stock.
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
    store.plan,
  );
  const prestige = Number(store.prestigePoints) || 0;
  const prestigeActive = store.plan !== "FREE";
  const detailTracked = await getTrackedSalesCounts([store.id]);

  // Check "sticky": se concede la primera vez que la tienda cumple y no se
  // pierde nunca.
  let justGranted = false;
  if (
    store.verifiedAt === null &&
    isStoreVerified({
      prestigeActive,
      prestigePoints: prestige,
      prestigeGoal: store.prestigeGoal,
      createdAt: store.createdAt,
      trackedSales: detailTracked.get(store.id) ?? 0,
    })
  ) {
    justGranted = true;
    await db
      .update(stores)
      .set({ verifiedAt: new Date() })
      .where(and(eq(stores.id, store.id), isNull(stores.verifiedAt)));
  }

  res.json({
    ...rest,
    products: visibleProducts,
    followersCount: followers.length,
    contactAvailable: elig.contactAvailable,
    subscriptionStatus: elig.status,
    trialEndsAt: elig.trialEndsAt,
    prestigePoints: prestige,
    prestigeActive,
    prestigeGoal: store.prestigeGoal,
    verified: store.verifiedAt !== null || justGranted,
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

// ── Anti-fraude: reporte de un comprador ────────────────────────────────────
// Los clientes pueden reportar prácticas abusivas de una tienda (fraude,
// cobro sin entrega, pedido de pagos por fuera, etc.). Los reportes se
// acumulan y activan sanciones escalonadas automáticas:
//   >= 3 reportes  → suspensión de 14 días
//   >= 5 reportes  → veto permanente (lo revierte solo el admin)
const reportSchema = z.object({
  reason: z.string().min(5).max(500),
});

router.post("/:id/report", requireAuth, async (req: AuthRequest, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Cuéntanos brevemente qué pasó (mínimo 5 caracteres)." });

  const [store] = await db.select().from(stores).where(eq(stores.id, req.params.id)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada." });
  if (store.ownerId === req.userId) {
    return res.status(400).json({ error: "No puedes reportar tu propia tienda." });
  }

  // Anti-spam: un mismo comprador no puede reportar a la misma tienda 2 veces
  // seguidas (24h) si su primer reporte sigue abierto.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.storeId, store.id),
        eq(violations.reporterId, req.userId!),
        gte(violations.createdAt, dayAgo),
      ),
    );
  if (Number(recent?.n ?? 0) > 0) {
    return res.status(429).json({ error: "Ya enviaste un reporte para esta tienda. Espera un momento." });
  }

  const reason = parsed.data.reason;

  // Anotar la violación y revisar si se alcanzó el umbral.
  await insertViolation({
    type: "buyer_report",
    severity: "warning",
    storeId: store.id,
    reporterId: req.userId!,
    reason: `Comprador reportó la tienda: ${reason}`,
  });

  const [openReports] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.storeId, store.id),
        eq(violations.type, "buyer_report"),
        eq(violations.status, "OPEN"),
      ),
    );
  const flags = Number(openReports?.n ?? 0);

  let action: "none" | "suspended" | "banned" = "none";
  let suspendedUntil: Date | null = null;
  if (flags >= BAN_REPORT_FLAGS) {
    await banStore(store.id, `${flags} reportes de compradores abiertos (último: ${reason})`);
    action = "banned";
  } else if (flags >= SUSPENSION_REPORT_FLAGS) {
    const applied = await applySuspension(store.id, {
      days: SUSPENSION_REPORTS_DAYS,
      reason: `${flags} reportes de compradores abiertos. Suspendida automáticamente mientras el admin revisa.`,
      actionTaken: `auto_suspend_${SUSPENSION_REPORTS_DAYS}d_by_reports`,
    });
    suspendedUntil = applied.until;
    action = "suspended";
  }

  res.status(201).json({
    ok: true,
    action,
    suspendedUntil,
    message:
      action === "banned"
        ? "Gracias por avisarnos. Esta tienda fue retirada de la plataforma."
        : action === "suspended"
          ? "Gracias por avisarnos. La tienda quedó suspendida mientras revisamos el caso."
          : "Gracias por tu reporte. Nuestro equipo lo revisará.",
  });
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
