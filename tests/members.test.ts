import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, storeMembers, storeInvites } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `team-owner-${ts}@example.com`;
const helperEmail = `team-helper-${ts}@example.com`;
let ownerToken = "";
let helperToken = "";
let storeId = "";
let inviteCode = "";

async function register(email: string) {
  await request(app).post("/api/auth/register").send({ email, password: "demo123456", name: "Te", termsAccepted: true });
  // Nombre mínimo de 2: el registro exige; "Te" cumple.
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

describe("Colaboradoras por invitación", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    ownerToken = await register(ownerEmail);
    helperToken = await register(helperEmail);
    const s = await request(app).post("/api/stores").set("Authorization", `Bearer ${ownerToken}`).send({
      name: `Equipo ${ts}`, businessType: "ROPA",
    });
    storeId = s.body.id;
    await request(app).post(`/api/stores/${storeId}/products`).set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Camisa", price: 40000, stock: 5,
    });
  });

  afterAll(async () => {
    await db.delete(storeInvites).where(eq(storeInvites.storeId, storeId));
    await db.delete(storeMembers).where(eq(storeMembers.storeId, storeId));
    const prods = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId));
    for (const p of prods) await db.delete(products).where(eq(products.id, p.id));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
    await db.delete(users).where(eq(users.email, helperEmail));
  });

  it("solo la dueña genera código; colaboradora inexistente no", async () => {
    const no = await request(app).post(`/api/stores/${storeId}/invites`).set("Authorization", `Bearer ${helperToken}`);
    expect(no.status).toBe(403);
    const ok = await request(app).post(`/api/stores/${storeId}/invites`).set("Authorization", `Bearer ${ownerToken}`);
    expect(ok.status).toBe(201);
    expect(ok.body.code).toMatch(/^[A-Z2-9]{6}$/);
    inviteCode = ok.body.code;
  });

  it("canje: entra como colaboradora; duplicado y auto-unión se rechazan", async () => {
    const join = await request(app).post("/api/stores/join").set("Authorization", `Bearer ${helperToken}`).send({ code: inviteCode });
    expect(join.status).toBe(201);
    const dup = await request(app).post("/api/stores/join").set("Authorization", `Bearer ${helperToken}`).send({ code: inviteCode });
    expect(dup.status).toBe(409);
    const self = await request(app).post("/api/stores/join").set("Authorization", `Bearer ${ownerToken}`).send({ code: inviteCode });
    expect(self.status).toBe(409);
    const bad = await request(app).post("/api/stores/join").set("Authorization", `Bearer ${helperToken}`).send({ code: "XXXXXX" });
    expect(bad.status).toBe(404);
  });

  it("colaboradora opera (pedidos/productos) pero no trial ni planes", async () => {
    const orders = await request(app).get("/api/orders").set("Authorization", `Bearer ${helperToken}`);
    expect(orders.status).toBe(200);
    const mine = await request(app).get("/api/stores/mine").set("Authorization", `Bearer ${helperToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).toBe(storeId);
    expect(mine.body.isOwner).toBe(false);
    const trial = await request(app).post(`/api/stores/${storeId}/trial`).set("Authorization", `Bearer ${helperToken}`);
    expect(trial.status).toBe(404);
  });

  it("dueña lista y quita; revocada pierde acceso", async () => {
    const list = await request(app).get(`/api/stores/${storeId}/members`).set("Authorization", `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.members.length).toBe(1);
    const helperId = (await db.select({ id: users.id }).from(users).where(eq(users.email, helperEmail)).limit(1))[0]!.id;
    const rm = await request(app).delete(`/api/stores/${storeId}/members/${helperId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(rm.status).toBe(200);
    const gone = await request(app).get("/api/orders").set("Authorization", `Bearer ${helperToken}`);
    expect(gone.status).toBe(404);
    // Revocar el código impide nuevos canjes.
    await request(app).delete(`/api/stores/${storeId}/invites`).set("Authorization", `Bearer ${ownerToken}`);
    const rejoin = await request(app).post("/api/stores/join").set("Authorization", `Bearer ${helperToken}`).send({ code: inviteCode });
    expect(rejoin.status).toBe(404);
  });

  it("Ajustes: perfil y clave", async () => {
    const me = await request(app).get("/api/users/me").set("Authorization", `Bearer ${ownerToken}`);
    expect(me.status).toBe(200);
    const patch = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Dueña Nueva" });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("Dueña Nueva");
    const badPass = await request(app).post("/api/users/me/password").set("Authorization", `Bearer ${ownerToken}`).send({
      currentPassword: "mala123456", newPassword: "nueva123456",
    });
    expect(badPass.status).toBe(403);
    const goodPass = await request(app).post("/api/users/me/password").set("Authorization", `Bearer ${ownerToken}`).send({
      currentPassword: "demo123456", newPassword: "nueva123456",
    });
    expect(goodPass.status).toBe(200);
    const relogin = await request(app).post("/api/auth/login").send({ email: ownerEmail, password: "nueva123456" });
    expect(relogin.status).toBe(200);
  });
});
