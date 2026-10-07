import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, passwordResets } from "../src/db/schema";
import { sendResetLink } from "../src/lib/email";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `reset-${ts}@example.com`;
const OLD_PASS = "demo123456";
const NEW_PASS = "nueva987654";

const tokenFromLink = (link: string) => link.split("/").pop() as string;

describe("Recuperación de contraseña (tokens en DB)", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    await request(app).post("/api/auth/register").send({
      email,
      password: OLD_PASS,
      name: "Reset User",
      termsAccepted: true,
    });
  });

  afterAll(async () => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (u) {
      await db.delete(passwordResets).where(eq(passwordResets.userId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  });

  it("no revela si el email existe (respuesta genérica)", async () => {
    const r = await request(app).post("/api/auth/forgot-password").send({ email: `nadie-${ts}@example.com` });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/recibirás el enlace/);
  });

  it("flujo completo: link → reset → login con la nueva, la vieja ya no entra", async () => {
    const link = await sendResetLink(email, "http://localhost:3000");
    const token = tokenFromLink(link);
    expect(token.length).toBeGreaterThan(10);

    // El token se guarda hasheado, nunca en claro.
    const [row] = await db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, createHash("sha256").update(token).digest("hex")))
      .limit(1);
    expect(row?.usedAt).toBeNull();

    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASS });
    expect(reset.status).toBe(200);
    expect(reset.body.token).toBeDefined();

    // Un solo uso: reutilizar falla.
    const reuse = await request(app).post("/api/auth/reset-password").send({ token, password: "otra123456" });
    expect(reuse.status).toBe(400);

    const loginNew = await request(app).post("/api/auth/login").send({ email, password: NEW_PASS });
    expect(loginNew.status).toBe(200);

    const loginOld = await request(app).post("/api/auth/login").send({ email, password: OLD_PASS });
    expect(loginOld.status).not.toBe(200);
  });

  it("rechaza token inventado y token vencido", async () => {
    const fake = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "00000000-0000-0000-0000-000000000000", password: NEW_PASS });
    expect(fake.status).toBe(400);

    const link = await sendResetLink(email, "http://localhost:3000");
    const token = tokenFromLink(link);
    await db
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResets.tokenHash, createHash("sha256").update(token).digest("hex")));
    const expired = await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASS });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toMatch(/expirado/);
  });
});
