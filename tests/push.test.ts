import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, deviceTokens } from "../src/db/schema";
import { notifyUser, pushAllowed, registerDeviceToken } from "../src/lib/push";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `push-${ts}@example.com`;
let token = "";
let userId = "";

describe("Push: registro de dispositivos y envío best-effort", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Push User",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
    token = login.body.token;
    userId = login.body.user.id;
  });

  afterAll(async () => {
    await db.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
    await db.delete(users).where(eq(users.email, email));
  });

  it("registra el token (idempotente) y lo borra al salir", async () => {
    const r1 = await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: "fcm-test-token-1234567890", platform: "android" });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: "fcm-test-token-1234567890" });
    expect(r2.status).toBe(201);

    const rows = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
    expect(rows.length).toBe(1);

    const del = await request(app)
      .delete("/api/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: "fcm-test-token-1234567890" });
    expect(del.status).toBe(200);
    const gone = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
    expect(gone.length).toBe(0);
  });

  it("rechaza token inválido y exige auth", async () => {
    const bad = await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: "x" });
    expect(bad.status).toBe(400);
    const noAuth = await request(app).post("/api/devices").send({ token: "fcm-test-token-1234567890" });
    expect(noAuth.status).toBe(401);
  });

  it("sin Firebase configurado el envío es no-op y no lanza", async () => {
    await registerDeviceToken(userId, "fcm-test-token-abcdef123456");
    const res = await notifyUser(userId, { title: "Hola", body: "Mundo" });
    expect(res.sent).toBe(0);
  });

  it("cooldown anti-spam: segundo push inmediato al mismo hilo se frena", async () => {
    const key = `test-${ts}`;
    expect(pushAllowed(key)).toBe(true);
    expect(pushAllowed(key)).toBe(false);
  });
});
