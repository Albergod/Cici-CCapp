import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  empresas,
  empresaMiembros,
  empresaTiendas,
  products,
  saleItems,
  sales,
  stores,
  users,
} from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `empresa-owner-${ts}@example.com`;
const helperEmail = `empresa-helper-${ts}@example.com`;
const outsiderEmail = `empresa-outsider-${ts}@example.com`;

let ownerToken = "";
let helperToken = "";
let outsiderToken = "";
let ownerStoreId = "";
let outsiderStoreId = "";
let ownerProductId = "";
let empresaId = "";

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

async function createStore(token: string, name: string) {
  const res = await request(app)
    .post("/api/stores")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, businessType: "ROPA" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("Cici Empresarios: operación de una empresa", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    ownerToken = await register(ownerEmail, "Dueña Empresa");
    helperToken = await register(helperEmail, "Admin Empresa");
    outsiderToken = await register(outsiderEmail, "Dueña Externa");

    ownerStoreId = await createStore(ownerToken, `Marca Principal ${ts}`);
    outsiderStoreId = await createStore(outsiderToken, `Marca Externa ${ts}`);

    const product = await request(app)
      .post(`/api/stores/${ownerStoreId}/products`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Camisa", price: 50000, stock: 4 });
    expect(product.status).toBe(201);
    ownerProductId = product.body.id;
  });

  afterAll(async () => {
    const storeIds = [ownerStoreId, outsiderStoreId].filter(Boolean);
    if (storeIds.length > 0) {
      const saleRows = await db
        .select({ id: sales.id })
        .from(sales)
        .where(inArray(sales.storeId, storeIds));
      const saleIds = saleRows.map((s) => s.id);
      if (saleIds.length > 0) {
        await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
        await db.delete(sales).where(inArray(sales.id, saleIds));
      }
      await db.delete(products).where(inArray(products.storeId, storeIds));
    }

    const empresaRows = await db
      .select({ id: empresas.id })
      .from(empresas)
      .where(eq(empresas.ownerId, (await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1))[0]?.id ?? ""));
    const empresaIds = empresaRows.map((e) => e.id);
    if (empresaIds.length > 0) {
      await db.delete(empresaTiendas).where(inArray(empresaTiendas.empresaId, empresaIds));
      await db.delete(empresaMiembros).where(inArray(empresaMiembros.empresaId, empresaIds));
      await db.delete(empresas).where(inArray(empresas.id, empresaIds));
    }

    if (storeIds.length > 0) {
      await db.delete(stores).where(inArray(stores.id, storeIds));
    }
    await db.delete(users).where(inArray(users.email, [ownerEmail, helperEmail, outsiderEmail]));
  });

  it("exige tienda propia para crear la empresa y deja a la dueña como OWNER", async () => {
    const noAuth = await request(app).post("/api/empresas").send({ name: "Grupo Prueba" });
    expect(noAuth.status).toBe(401);

    const noStore = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${helperToken}`)
      .send({ name: "Grupo Prueba" });
    expect(noStore.status).toBe(400);

    const created = await request(app)
      .post("/api/empresas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Grupo ${ts}` });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("OWNER");
    empresaId = created.body.id;

    const mine = await request(app)
      .get("/api/empresas/mine")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.some((row: { id: string; role: string }) => row.id === empresaId && row.role === "OWNER")).toBe(true);

    const detail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.miembros.some((m: { role: string }) => m.role === "OWNER")).toBe(true);
    expect(detail.body.tiendas).toHaveLength(0);
  });

  it("solo la dueña de la tienda puede vincularla y no se permite duplicar", async () => {
    const link = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: ownerStoreId });
    expect(link.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: ownerStoreId });
    expect(duplicate.status).toBe(409);

    const foreignStore = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ storeId: outsiderStoreId });
    expect(foreignStore.status).toBe(403);

    const sale = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ productId: ownerProductId, quantity: 1 }], paymentMethod: "EFECTIVO" });
    expect(sale.status).toBe(201);

    const detail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tiendas).toHaveLength(1);
    expect(detail.body.tiendas[0].id).toBe(ownerStoreId);
    expect(detail.body.tiendas[0].productos).toBe(1);
    expect(detail.body.resumen.ventasCount).toBe(1);
    expect(detail.body.resumen.ventasTotal).toBeGreaterThan(0);
    expect(detail.body.resumen.ventas30d).toBeGreaterThan(0);
  });

  it("gestiona roles: VIEWER consulta, ADMIN opera y solo la dueña cambia roles", async () => {
    const invite = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: helperEmail, role: "VIEWER" });
    expect(invite.status).toBe(201);

    const viewerDetail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${helperToken}`);
    expect(viewerDetail.status).toBe(200);
    expect(viewerDetail.body.role).toBe("VIEWER");

    const viewerInvite = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${helperToken}`)
      .send({ email: outsiderEmail, role: "VIEWER" });
    expect(viewerInvite.status).toBe(403);

    const viewerLink = await request(app)
      .post(`/api/empresas/${empresaId}/tiendas`)
      .set("Authorization", `Bearer ${helperToken}`)
      .send({ storeId: ownerStoreId });
    expect(viewerLink.status).toBe(403);

    const promote = await request(app)
      .patch(`/api/empresas/${empresaId}/miembros/${(await db.select({ id: users.id }).from(users).where(eq(users.email, helperEmail)).limit(1))[0]!.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "ADMIN" });
    expect(promote.status).toBe(200);

    const adminInvite = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${helperToken}`)
      .send({ email: outsiderEmail, role: "ADMIN" });
    expect(adminInvite.status).toBe(403);

    const adminInviteViewer = await request(app)
      .post(`/api/empresas/${empresaId}/miembros`)
      .set("Authorization", `Bearer ${helperToken}`)
      .send({ email: outsiderEmail, role: "VIEWER" });
    expect(adminInviteViewer.status).toBe(201);
  });

  it("renombra y desvincula sin tocar la tienda", async () => {
    const renamed = await request(app)
      .patch(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Grupo Renombrado ${ts}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe(`Grupo Renombrado ${ts}`);

    const unlink = await request(app)
      .delete(`/api/empresas/${empresaId}/tiendas/${ownerStoreId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(unlink.status).toBe(200);

    const detail = await request(app)
      .get(`/api/empresas/${empresaId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tiendas).toHaveLength(0);

    const [stillThere] = await db
      .select({ name: stores.name })
      .from(stores)
      .where(eq(stores.id, ownerStoreId))
      .limit(1);
    expect(stillThere?.name).toBe(`Marca Principal ${ts}`);
  });
});
