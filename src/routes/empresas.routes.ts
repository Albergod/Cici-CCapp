import { Router } from "express";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  empresas,
  empresaMiembros,
  empresaTiendas,
  products,
  sales,
  stores,
  users,
} from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { canManageEmpresa, getEmpresaAccess, EmpresaRole } from "../lib/empresas";
import { assertStoreOwner } from "../lib/members";

const router = Router();

router.use(requireAuth);

const nameSchema = z.string().trim().min(2, "Escribe el nombre de la empresa.").max(120);
const uuidSchema = z.string().uuid("Identificador inválido.");

const memberRoleSchema = z.enum(["ADMIN", "VIEWER"]);

// GET /api/empresas/mine — empresas donde soy dueña o miembro.
router.get("/mine", async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const rows = await db
    .select({
      id: empresas.id,
      name: empresas.name,
      ownerId: empresas.ownerId,
      createdAt: empresas.createdAt,
      updatedAt: empresas.updatedAt,
      role: sql<EmpresaRole>`case when ${empresas.ownerId} = ${userId} then 'OWNER' else ${empresaMiembros.role} end`,
      tiendasCount: sql<number>`(select count(*)::int from ${empresaTiendas} where ${empresaTiendas.empresaId} = ${empresas.id})`,
      miembrosCount: sql<number>`(select count(*)::int from ${empresaMiembros} where ${empresaMiembros.empresaId} = ${empresas.id})`,
    })
    .from(empresas)
    .leftJoin(
      empresaMiembros,
      and(
        eq(empresaMiembros.empresaId, empresas.id),
        eq(empresaMiembros.userId, userId),
      ),
    )
    .where(or(eq(empresas.ownerId, userId), eq(empresaMiembros.userId, userId)))
    .orderBy(desc(empresas.createdAt));

  res.json(rows);
});

// POST /api/empresas — crear organización. Requiere al menos una tienda propia
// para que la empresa nazca con algo que agrupar.
router.post("/", async (req: AuthRequest, res) => {
  const parsed = z.object({ name: nameSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." });
  }

  const userId = req.userId!;
  const [ownedStore] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, userId))
    .limit(1);
  if (!ownedStore) {
    return res.status(400).json({
      error: "Primero crea una tienda. Una empresa se construye agrupando tiendas que ya son tuyas.",
    });
  }

  const empresa = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(empresas)
      .values({ name: parsed.data.name, ownerId: userId })
      .returning();
    await tx.insert(empresaMiembros).values({
      empresaId: created.id,
      userId,
      role: "OWNER",
    });
    return created;
  });

  res.status(201).json({
    ...empresa,
    role: "OWNER",
    tiendasCount: 0,
    miembrosCount: 1,
  });
});

// GET /api/empresas/:id — detalle con tiendas, equipo y consolidado.
router.get("/:id", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Empresa inválida." });

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok || !access.empresa) {
    return res.status(access.status ?? 403).json({ error: access.msg ?? "Sin acceso." });
  }

  const linked = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      plan: stores.plan,
      status: stores.status,
      logoUrl: stores.logoUrl,
      businessType: stores.businessType,
      linkedAt: empresaTiendas.createdAt,
    })
    .from(empresaTiendas)
    .innerJoin(stores, eq(empresaTiendas.storeId, stores.id))
    .where(eq(empresaTiendas.empresaId, id.data))
    .orderBy(asc(stores.name));

  const storeIds = linked.map((s) => s.id);
  const salesByStore = new Map<
    string,
    { total: number; last30: number; count: number }
  >();
  const productsByStore = new Map<string, number>();

  if (storeIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const salesRows = await db
      .select({
        storeId: sales.storeId,
        total: sql<string>`coalesce(sum(${sales.total}), 0)`,
        last30: sql<string>`coalesce(sum(case when ${sales.soldAt} >= ${since} then ${sales.total} else 0 end), 0)`,
        count: count(sales.id),
      })
      .from(sales)
      .where(inArray(sales.storeId, storeIds))
      .groupBy(sales.storeId);

    for (const row of salesRows) {
      salesByStore.set(row.storeId, {
        total: Number(row.total),
        last30: Number(row.last30),
        count: Number(row.count),
      });
    }

    const productRows = await db
      .select({ storeId: products.storeId, total: count(products.id) })
      .from(products)
      .where(inArray(products.storeId, storeIds))
      .groupBy(products.storeId);

    for (const row of productRows) {
      productsByStore.set(row.storeId, Number(row.total));
    }
  }

  const tiendas = linked.map((store) => {
    const stats = salesByStore.get(store.id);
    return {
      ...store,
      ventasTotal: stats?.total ?? 0,
      ventas30d: stats?.last30 ?? 0,
      ventasCount: stats?.count ?? 0,
      productos: productsByStore.get(store.id) ?? 0,
    };
  });

  const miembros = await db
    .select({
      id: empresaMiembros.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: empresaMiembros.role,
      createdAt: empresaMiembros.createdAt,
    })
    .from(empresaMiembros)
    .innerJoin(users, eq(empresaMiembros.userId, users.id))
    .where(eq(empresaMiembros.empresaId, id.data))
    .orderBy(asc(empresaMiembros.createdAt));

  let tiendasDisponibles: Array<{ id: string; name: string; slug: string; logoUrl: string | null }> = [];
  if (canManageEmpresa(access.role)) {
    const owned = await db
      .select({ id: stores.id, name: stores.name, slug: stores.slug, logoUrl: stores.logoUrl })
      .from(stores)
      .where(eq(stores.ownerId, req.userId!))
      .orderBy(asc(stores.name));

    if (owned.length > 0) {
      const alreadyLinked = await db
        .select({ storeId: empresaTiendas.storeId })
        .from(empresaTiendas)
        .where(inArray(empresaTiendas.storeId, owned.map((s) => s.id)));
      const linkedSet = new Set(alreadyLinked.map((r) => r.storeId));
      tiendasDisponibles = owned.filter((s) => !linkedSet.has(s.id));
    }
  }

  res.json({
    id: access.empresa.id,
    name: access.empresa.name,
    ownerId: access.empresa.ownerId,
    createdAt: access.empresa.createdAt,
    updatedAt: access.empresa.updatedAt,
    role: access.role,
    tiendas,
    miembros,
    tiendasDisponibles,
    resumen: {
      tiendas: tiendas.length,
      miembros: miembros.length,
      ventasTotal: tiendas.reduce((sum, s) => sum + s.ventasTotal, 0),
      ventas30d: tiendas.reduce((sum, s) => sum + s.ventas30d, 0),
      ventasCount: tiendas.reduce((sum, s) => sum + s.ventasCount, 0),
      productos: tiendas.reduce((sum, s) => sum + s.productos, 0),
    },
  });
});

// PATCH /api/empresas/:id — renombrar. Dueña o ADMIN.
router.patch("/:id", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Empresa inválida." });

  const parsed = z.object({ name: nameSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (!canManageEmpresa(access.role)) {
    return res.status(403).json({ error: "No puedes editar esta empresa." });
  }

  const [updated] = await db
    .update(empresas)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(empresas.id, id.data))
    .returning();

  res.json(updated);
});

// POST /api/empresas/:id/tiendas — vincular una tienda propia.
router.post("/:id/tiendas", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Empresa inválida." });

  const parsed = z.object({ storeId: uuidSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Tienda inválida." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (!canManageEmpresa(access.role)) {
    return res.status(403).json({ error: "No puedes vincular tiendas a esta empresa." });
  }

  const storeAccess = await assertStoreOwner(parsed.data.storeId, req.userId!);
  if (!storeAccess.ok) {
    return res.status(storeAccess.status ?? 403).json({
      error: "Solo la dueña de la tienda puede vincularla a una empresa.",
    });
  }

  const [existing] = await db
    .select({ empresaId: empresaTiendas.empresaId })
    .from(empresaTiendas)
    .where(eq(empresaTiendas.storeId, parsed.data.storeId))
    .limit(1);
  if (existing) {
    return res.status(409).json({
      error:
        existing.empresaId === id.data
          ? "Esta tienda ya está vinculada a la empresa."
          : "Esta tienda ya pertenece a otra empresa.",
    });
  }

  try {
    await db.insert(empresaTiendas).values({
      empresaId: id.data,
      storeId: parsed.data.storeId,
      linkedByUserId: req.userId!,
    });
  } catch {
    return res.status(409).json({ error: "No se pudo vincular la tienda. Intenta de nuevo." });
  }

  res.status(201).json({ ok: true, storeId: parsed.data.storeId });
});

// DELETE /api/empresas/:id/tiendas/:storeId — desvincular. Dueña/ADMIN de la
// empresa y dueña de la tienda.
router.delete("/:id/tiendas/:storeId", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const storeId = uuidSchema.safeParse(req.params.storeId);
  if (!id.success || !storeId.success) {
    return res.status(400).json({ error: "Identificador inválido." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (!canManageEmpresa(access.role)) {
    return res.status(403).json({ error: "No puedes desvincular tiendas de esta empresa." });
  }

  const storeAccess = await assertStoreOwner(storeId.data, req.userId!);
  if (!storeAccess.ok) {
    return res.status(storeAccess.status ?? 403).json({
      error: "Solo la dueña de la tienda puede desvincularla.",
    });
  }

  const deleted = await db
    .delete(empresaTiendas)
    .where(
      and(
        eq(empresaTiendas.empresaId, id.data),
        eq(empresaTiendas.storeId, storeId.data),
      ),
    )
    .returning({ id: empresaTiendas.id });

  if (deleted.length === 0) {
    return res.status(404).json({ error: "La tienda no está vinculada a esta empresa." });
  }
  res.json({ ok: true });
});

// POST /api/empresas/:id/miembros — invitar por correo a una cuenta existente.
router.post("/:id/miembros", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Empresa inválida." });

  const parsed = z
    .object({
      email: z.string().trim().email("Escribe un correo válido.").max(160),
      role: memberRoleSchema.default("VIEWER"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (!canManageEmpresa(access.role)) {
    return res.status(403).json({ error: "No puedes gestionar el equipo de esta empresa." });
  }
  if (parsed.data.role === "ADMIN" && access.role !== "OWNER") {
    return res.status(403).json({ error: "Solo la dueña puede nombrar administradores." });
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.email, parsed.data.email.toLowerCase()))
    .limit(1);
  if (!user) {
    return res.status(404).json({
      error: "No existe una cuenta con ese correo. La persona debe registrarse primero en Cici.",
    });
  }
  if (user.id === access.empresa?.ownerId) {
    return res.status(409).json({ error: "Esa persona ya es dueña de la empresa." });
  }

  try {
    const [member] = await db
      .insert(empresaMiembros)
      .values({ empresaId: id.data, userId: user.id, role: parsed.data.role })
      .returning();
    return res.status(201).json({ ...member, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
  } catch {
    return res.status(409).json({ error: "Esa persona ya pertenece al equipo de la empresa." });
  }
});

// PATCH /api/empresas/:id/miembros/:userId — cambiar rol. Solo la dueña.
router.patch("/:id/miembros/:userId", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const userId = uuidSchema.safeParse(req.params.userId);
  if (!id.success || !userId.success) {
    return res.status(400).json({ error: "Identificador inválido." });
  }

  const parsed = z.object({ role: memberRoleSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Rol inválido." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (access.role !== "OWNER") {
    return res.status(403).json({ error: "Solo la dueña puede cambiar roles." });
  }
  if (userId.data === access.empresa?.ownerId) {
    return res.status(400).json({ error: "El rol de la dueña no se puede cambiar." });
  }

  const [updated] = await db
    .update(empresaMiembros)
    .set({ role: parsed.data.role })
    .where(
      and(
        eq(empresaMiembros.empresaId, id.data),
        eq(empresaMiembros.userId, userId.data),
      ),
    )
    .returning();
  if (!updated) return res.status(404).json({ error: "Esa persona no pertenece a la empresa." });

  res.json(updated);
});

// DELETE /api/empresas/:id/miembros/:userId — quitar del equipo. La dueña
// puede quitar a cualquiera; un ADMIN solo a VIEWER.
router.delete("/:id/miembros/:userId", async (req: AuthRequest, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const userId = uuidSchema.safeParse(req.params.userId);
  if (!id.success || !userId.success) {
    return res.status(400).json({ error: "Identificador inválido." });
  }

  const access = await getEmpresaAccess(id.data, req.userId!);
  if (!access.ok) return res.status(access.status ?? 403).json({ error: access.msg });
  if (!canManageEmpresa(access.role)) {
    return res.status(403).json({ error: "No puedes gestionar el equipo de esta empresa." });
  }
  if (userId.data === access.empresa?.ownerId) {
    return res.status(400).json({ error: "La dueña no se puede quitar de su propia empresa." });
  }

  const [target] = await db
    .select({ role: empresaMiembros.role })
    .from(empresaMiembros)
    .where(
      and(
        eq(empresaMiembros.empresaId, id.data),
        eq(empresaMiembros.userId, userId.data),
      ),
    )
    .limit(1);
  if (!target) return res.status(404).json({ error: "Esa persona no pertenece a la empresa." });
  if (access.role === "ADMIN" && target.role !== "VIEWER") {
    return res.status(403).json({ error: "Un administrador solo puede quitar consultores." });
  }

  await db
    .delete(empresaMiembros)
    .where(
      and(
        eq(empresaMiembros.empresaId, id.data),
        eq(empresaMiembros.userId, userId.data),
      ),
    );
  res.json({ ok: true });
});

export default router;
