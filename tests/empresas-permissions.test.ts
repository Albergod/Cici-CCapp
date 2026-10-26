import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { empresas, empresaMiembros, empresaTiendas, stores, users } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `perm-owner-${ts}@example.com`;
const adminEmail = `perm-admin-${ts}@example.com`;
const viewerEmail = `perm-viewer-${ts}@example.com`;
const strangerEmail = `perm-stranger-${ts}@example.com`;

let ownerToken = "";
let adminToken = "";
let viewerToken = "";
let strangerToken = "";
let ownerUserId = "";
let adminUserId = "";
let viewerUserId = "";
let strangerUserId = "";
let storeA = "";
let storeB = "";
let empresaId = "";
let empresa2Id = "";

async function register(email: string, name: string) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "demo123456", name, termsAccepted: true });
  expect(res.status).toBe(201);
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "demo123456" });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

async function userIdByEmail(email: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row?.id ?? "";
}

async function createStore(token: string, name: string) {
  const res = await request(app)
    .post("/api/stores")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, businessType: "ROPA" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("Cici Empresarios: permisos y bordes de la operación", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    ownerToken = await register(ownerEmail, "Dueña Permisos");
    adminToken = await register(adminEmail, "Admin Permisos");
    viewerToken = await register(viewerEmail, "Viewer Permisos");
    strangerToken = await register(strangerEmail, "Ajena Permisos");

    ownerUserId = await userIdByEmail(ownerEmail);
    adminUserId = await userIdByEmail(adminEmail);
    viewerUserId = await userIdByEmail(viewerEmail);
    strangerUserId = await userIdByEmail(strangerEmail);

    storeA = await createStore(ownerToken, `Perm A ${ts}`);
    storeB = await createStore(adminToken, `Perm B ${ts}`);
  });

  afterAll(async () => {
    const ids = [empresaId, empresa2Id].filter(Boolean);
    if (ids.length > 0) {
      await db.delete(empresaTiendas).where(inArray(empresaTiendas.empresaId, ids));
      await db.delete(empresaMiembros).where(inArray(empresaMiembros.empresaId, ids));
      await db.delete(empresas).where(inArray(empresas.id, ids));
    }
    const storeIds = [storeA, storeB].filter(Boolean);
    if (storeIds.length > 0) {
      await db.delete(stores).where(inArray(stores.id, storeIds));
    }
    await db
      .delete(users)
      .where(inArray(users.email, [ownerEmail, adminEmail, viewerEmail, strangerEmail]));
  });

  it("crea la empresa con validaciones y protege el acceso al detalle", async () => {
    const noAuth = await request(app).get("/api/empresas/mine");
    expect(noAuth.status).toBe(401);

    const blank = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: " " });
    expect(blank.status).toBe(400);

    const noStore = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ name: "Sin tienda" });
    expect(noStore.status).toBe(400);

    const created = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Permisos ${ts}` });
    expect(created.status).toBe(201);
    empresaId = created.body.id;
    expect(created.body.role).toBe("OWNER");

    const invalid = await request(app)
      .get("/api/empresas/not-a-uuid")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(invalid.status).toBe(400);

    const missing = await request(app)
      .get(`/api/empresas/${randomUUID()}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(missing.status).toBe(404);

    const strangerDetail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerDetail.status).toBe(403);

    const mine = await request(app)
      .get("/api/empresas/mine")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body[0].role).toBe("OWNER");
  });

  it("solo la dueña de cada tienda puede vincularla y no se duplica", async () => {
    const before = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(before.status).toBe(200);
    expect(before.body.tiendasDisponibles.map((s: { id: string }) => s.id)).toEqual([storeA]);

    const link = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: storeA });
    expect(link.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: storeA });
    expect(duplicate.status).toBe(409);

    const invalidStore = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: "not-a-uuid" });
    expect(invalidStore.status).toBe(400);

    const missingStore = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: randomUUID() });
    expect(missingStore.status).toBe(404);

    const detail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tiendas).toHaveLength(1);
    expect(detail.body.tiendasDisponibles).toEqual([]);
  });

  it("valida el alta de miembros: duplicados, dueña, correo y rol", async () => {
    const addAdmin = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: adminEmail, role: "ADMIN" });
    expect(addAdmin.status).toBe(201);

    const addViewer = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: viewerEmail, role: "VIEWER" });
    expect(addViewer.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: adminEmail, role: "VIEWER" });
    expect(duplicate.status).toBe(409);

    const ownerSelf = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: ownerEmail, role: "VIEWER" });
    expect(ownerSelf.status).toBe(409);

    const missingAccount = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: `no-existe-${ts}@example.com`, role: "VIEWER" });
    expect(missingAccount.status).toBe(404);

    const badRole = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: strangerEmail, role: "OWNER" });
    expect(badRole.status).toBe(400);
  });

  it("VIEWER solo consulta; ADMIN opera pero no cambia roles", async () => {
    const viewerDetail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerDetail.status).toBe(200);
    expect(viewerDetail.body.role).toBe("VIEWER");
    expect(viewerDetail.body.tiendasDisponibles).toEqual([]);

    for (const res of [
      await request(app)
        .patch(`/api/empresas/${empresaId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ name: "Viewer no edita" }),
      await request(app)
        .post(`/api/empresas/${empresaId}/tiendas`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ storeId: storeB }),
      await request(app)
        .delete(`/api/empresas/${empresaId}/tiendas/${storeA}`)
        .set("Authorization", `Bearer ${viewerToken}`),
      await request(app)
        .post(`/api/empresas/${empresaId}/miembros`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ email: strangerEmail, role: "VIEWER" }),
      await request(app)
        .delete(`/api/empresas/${empresaId}/miembros/${adminUserId}`)
        .set("Authorization", `Bearer ${viewerToken}`),
    ]) {
      expect(res.status).toBe(403);
    }

    const adminDetail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.role).toBe("ADMIN");

    const adminRename = await request(app)
      .patch(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `Renombrada por admin ${ts}` });
    expect(adminRename.status).toBe(200);

    const adminAddViewer = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: strangerEmail, role: "VIEWER" });
    expect(adminAddViewer.status).toBe(201);

    const adminAddAdmin = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: `otro-${ts}@example.com`, role: "ADMIN" });
    expect(adminAddAdmin.status).toBe(403);

    const adminChangeRole = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${viewerUserId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "ADMIN" });
    expect(adminChangeRole.status).toBe(403);

    const adminLink = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ storeId: storeB });
    expect(adminLink.status).toBe(201);

    const adminUnlinkForeign = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${storeA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminUnlinkForeign.status).toBe(403);
  });

  it("solo la dueña cambia roles y no puede degradarse ni quitarse", async () => {
    const promote = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${viewerUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "ADMIN" });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe("ADMIN");

    const selfRole = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${ownerUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "VIEWER" });
    expect(selfRole.status).toBe(400);

    const removeSelf = await request(app)
      .delete(`/api/empresas/${empresaId}/miembros/${ownerUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(removeSelf.status).toBe(400);

    const invalidRole = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${viewerUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "OWNER" });
    expect(invalidRole.status).toBe(400);

    const missingMember = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${randomUUID()}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "VIEWER" });
    expect(missingMember.status).toBe(404);
  });

  it("ADMIN solo quita VIEWER; la dueña quita a cualquiera", async () => {
    const adminRemovesAdmin = await request(app)
      .delete(`/api/empresas/${empresaId}/miembros/${viewerUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRemovesAdmin.status).toBe(403);

    const adminRemovesViewer = await request(app)
      .delete(`/api/empresas/${empresaId}/miembros/${strangerUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRemovesViewer.status).toBe(200);

    const ownerRemovesAdmin = await request(app)
      .delete(`/api/empresas/${empresaId}/miembros/${viewerUserId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerRemovesAdmin.status).toBe(200);

    const removeMissing = await request(app)
      .delete(`/api/empresas/${empresaId}/miembros/${randomUUID()}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(removeMissing.status).toBe(404);
  });

  it("desvincula solo a la dueña de la tienda y conserva la tienda", async () => {
    const invalid = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/not-a-uuid`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(invalid.status).toBe(400);

    const ownerUnlinksOwn = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${storeA}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerUnlinksOwn.status).toBe(200);

    const ownerUnlinksForeign = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${storeB}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerUnlinksForeign.status).toBe(403);

    const adminUnlinksOwn = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${storeB}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminUnlinksOwn.status).toBe(200);

    const adminUnlinksAgain = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${storeB}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminUnlinksAgain.status).toBe(404);

    for (const id of [storeA, storeB]) {
      const [stillThere] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      expect(stillThere?.id).toBe(id);
    }
  });

  it("impide que una tienda se vincule a dos empresas", async () => {
    const created = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Segunda ${ts}` });
    expect(created.status).toBe(201);
    empresa2Id = created.body.id;

    const linkToSecond = await request(app)
      .post(`/api/empresas/${empresa2Id}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: storeA });
    expect(linkToSecond.status).toBe(201);

    const linkToFirst = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: storeA });
    expect(linkToFirst.status).toBe(409);
    expect(linkToFirst.body.error).toMatch(/otra empresa/i);
  });

  it("lista mis empresas con el rol correcto para admin y viewer", async () => {
    const addViewer = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: viewerEmail, role: "VIEWER" });
    expect(addViewer.status).toBe(201);

    const adminMine = await request(app)
      .get("/api/empresas/mine")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminMine.status).toBe(200);
    expect(adminMine.body[0].role).toBe("ADMIN");

    const viewerMine = await request(app)
      .get("/api/empresas/mine")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerMine.status).toBe(200);
    expect(viewerMine.body[0].role).toBe("VIEWER");

    const strangerMine = await request(app)
      .get("/api/empresas/mine")
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerMine.status).toBe(200);
    expect(strangerMine.body).toEqual([]);
  });
});
