import { Router } from "express";
import { z } from "zod";
import { eq, and, desc, count, sql, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { stores, users, violations } from "../db/schema";
import { AuthRequest } from "../middleware/auth";
import {
  applySuspension,
  banStore,
  reauthorizeExpiredSuspensions,
} from "../lib/moderation";

const router = Router();

// Requiere el header X-Admin-Token == ADMIN_TOKEN (el panel pregunta el token).
const requireAdmin = (req: AuthRequest, res: any, next: any) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(503).json({ error: "Admin endpoint deshabilitado" });
  if (req.headers["x-admin-token"] !== adminToken) {
    return res.status(403).json({ error: "Token de administrador inválido" });
  }
  next();
};

// ── Lista de violaciones / sanciones (filtrables por estado y tipo) ─────────
// GET /api/admin/violations?status=OPEN&type=buyer_report&page=&limit=
router.get("/violations", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;

    const conditions = [];
    if (status) conditions.push(eq(violations.status, status));
    if (type) conditions.push(eq(violations.type, type));

    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRows] = await db
      .select({ total: count(violations.id) })
      .from(violations)
      .where(where);

    const rows = await db
      .select({
        id: violations.id,
        type: violations.type,
        severity: violations.severity,
        status: violations.status,
        reason: violations.reason,
        metadata: violations.metadata,
        actionTaken: violations.actionTaken,
        resolvedNote: violations.resolvedNote,
        createdAt: violations.createdAt,
        resolvedAt: violations.resolvedAt,
        store: {
          name: stores.name,
          slug: stores.slug,
          storeStatus: stores.status,
        },
        reporter: {
          name: users.name,
          email: users.email,
        },
      })
      .from(violations)
      .leftJoin(stores, eq(violations.storeId, stores.id))
      .leftJoin(users, eq(violations.reporterId, users.id))
      .where(where)
      .orderBy(desc(violations.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ rows, total: Number(totalRows?.total ?? 0), page, limit, totalPages: Math.ceil(Number(totalRows?.total ?? 0) / limit) });
  } catch (err) {
    console.error("admin violations error:", err);
    res.status(500).json({ error: "Error al obtener violaciones" });
  }
});

// ── Resolver / ignorar una violación ─────────────────────────────────────────
// PATCH /api/admin/violations/:id  { status: "RESOLVED", note }
router.patch("/violations/:id", requireAdmin, async (req: AuthRequest, res) => {
  const parsed = z
    .object({
      status: z.enum(["OPEN", "RESOLVED"]).optional(),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Cuerpo inválido" });

  const patch: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.note !== undefined) patch.resolvedNote = parsed.data.note;
  if (parsed.data.status === "RESOLVED" && !patch.resolvedNote) {
    patch.resolvedNote = "Revisada por el administrador";
  }
  if (parsed.data.status === "RESOLVED") patch.resolvedAt = new Date();

  const [updated] = await db
    .update(violations)
    .set(patch)
    .where(eq(violations.id, req.params.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Violación no encontrada" });
  res.json(updated);
});

// ── Lista de tiendas con su estado de sanción ────────────────────────────────
// GET /api/admin/stores?status=SUSPENDED&page=&limit=
router.get("/stores", requireAdmin, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    await reauthorizeExpiredSuspensions();

    const where = status ? eq(stores.status, status as "ACTIVE" | "SUSPENDED" | "BANNED") : undefined;
    const [totalRows] = await db.select({ total: count(stores.id) }).from(stores).where(where);

    const rows = await db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        plan: stores.plan,
        status: stores.status,
        suspensionEndsAt: stores.suspensionEndsAt,
        sanctionsCount: stores.sanctionsCount,
        banReason: stores.banReason,
        createdAt: stores.createdAt,
        owner: { name: users.name, email: users.email },
      })
      .from(stores)
      .leftJoin(users, eq(stores.ownerId, users.id))
      .where(where)
      .orderBy(desc(stores.createdAt))
      .limit(limit)
      .offset(offset);

    // Contar violaciones abiertas por tienda (una query extra, en lote).
    const openByStore: Record<string, number> = {};
    if (rows.length) {
      const counts = await db
        .select({
          storeId: violations.storeId,
          n: sql<number>`count(*)::int`,
        })
        .from(violations)
        .where(and(eq(violations.status, "OPEN"), isNull(violations.resolvedAt)))
        .groupBy(violations.storeId);
      for (const r of counts) if (r.storeId) openByStore[r.storeId] = Number(r.n);
    }

    const withOpen = rows.map((r) => ({ ...r, openViolations: openByStore[r.id] ?? 0 }));

    res.json({ rows: withOpen, total: Number(totalRows?.total ?? 0), page, limit, totalPages: Math.ceil(Number(totalRows?.total ?? 0) / limit) });
  } catch (err) {
    console.error("admin stores error:", err);
    res.status(500).json({ error: "Error al obtener tiendas" });
  }
});

// ── Suspender una tienda (N días) ────────────────────────────────────────────
// POST /api/admin/stores/:id/suspend  { days?, hours?, reason }
router.post("/stores/:id/suspend", requireAdmin, async (req: AuthRequest, res) => {
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, req.params.id)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  const parsed = z
    .object({
      days: z.number().int().min(1).max(365).optional(),
      hours: z.number().int().min(1).max(24 * 7).optional(),
      reason: z.string().min(3).max(500),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos (days/hours/reason)" });

  const applied = await applySuspension(store.id, {
    days: parsed.data.days ?? 0,
    hours: parsed.data.hours ?? 0,
    reason: parsed.data.reason,
    actionTaken: `suspendido ${parsed.data.days ? parsed.data.days + " días" : parsed.data.hours + " horas"}`,
  });

  res.json({ ok: true, until: applied.until });
});

// ── Veto permanente de una tienda ────────────────────────────────────────────
// POST /api/admin/stores/:id/ban  { reason }
router.post("/stores/:id/ban", requireAdmin, async (req: AuthRequest, res) => {
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, req.params.id)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  const parsed = z.object({ reason: z.string().min(3).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Motivo requerido (mín. 3 caracteres)" });

  await banStore(store.id, parsed.data.reason);
  res.json({ ok: true });
});

// ── Reactivar / des-bannear una tienda ───────────────────────────────────────
// POST /api/admin/stores/:id/unban  { reason } (opcional)
router.post("/stores/:id/unban", requireAdmin, async (req: AuthRequest, res) => {
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, req.params.id)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  const parsed = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body);
  const reason = parsed.success && parsed.data.reason ? parsed.data.reason : "Reactivada por el administrador";

  await db
    .update(stores)
    .set({ status: "ACTIVE", suspensionEndsAt: null, banReason: null })
    .where(eq(stores.id, store.id));

  await db.insert(violations).values({
    type: "admin_action",
    severity: "info",
    status: "RESOLVED",
    storeId: store.id,
    reason,
    actionTaken: "unban",
    resolvedAt: new Date(),
  });

  res.json({ ok: true });
});

export default router;