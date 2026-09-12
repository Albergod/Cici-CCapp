import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import "dotenv/config";

let app: Express;

describe("Flujo crítico (LOGIN → CREAR TIENDA → CHECKOUT)", () => {
  beforeAll(async () => {
    // Importar el código TS directamente usando esm.
    // vitest usa esbuild para transformar.
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  it("debe permitir registro y login", async () => {
    const email = `test-${Date.now()}@example.com`;
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Test User",
    });
    const r = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeDefined();
  });

  it("debe crear una tienda FREE", async () => {
    const email = `store-${Date.now()}@example.com`;
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Store Owner",
    });
    const login = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    const token = login.body.token;

    const r = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tienda Test", description: "Test", businessType: "OTRO" });
    expect(r.status).toBe(201);
    expect(r.body.plan).toBe("FREE");
  });
});