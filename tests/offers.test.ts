import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `offer-${ts}@example.com`;
let token = "";
let storeId = "";
let storeSlug = "";
let productId = "";

async function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

describe("Ofertas estilo Shopee (precio promo + fin)", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Offer Owner",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
    token = login.body.token;

    const s = await request(app)
      .post("/api/stores")
      .set(await authHeaders())
      .send({ name: `Ofertas ${ts}`, description: "Test", businessType: "ROPA" });
    expect(s.status).toBe(201);
    storeId = s.body.id;
    storeSlug = s.body.slug;

    const p = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set(await authHeaders())
      .send({ name: "Jean Oferta", price: 100000, stock: 10 });
    expect(p.status).toBe(201);
    productId = p.body.id;
  });

  afterAll(async () => {
    const prods = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId));
    if (prods.length) await db.delete(products).where(inArray(products.id, prods.map((p) => p.id)));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, email));
  });

  it("rechaza promo mayor o igual al precio base", async () => {
    const ends = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 120000, offerEndsAt: ends });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/menor al precio normal/);
  });

  it("rechaza fecha de fin pasada o mayor a 30 días", async () => {
    const past = await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 80000, offerEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);

    const far = await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 80000, offerEndsAt: new Date(Date.now() + 60 * 86_400_000).toISOString() });
    expect(far.status).toBe(400);
  });

  it("activa la oferta y el detalle público muestra precio efectivo + flags", async () => {
    const ends = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const r = await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 75000, offerEndsAt: ends });
    expect(r.status).toBe(200);

    const detail = await request(app).get(`/api/stores/${storeSlug}`);
    expect(detail.status).toBe(200);
    const prod = (detail.body.products as unknown[]).find(
      (p) => (p as { id: string }).id === productId,
    ) as { effectivePrice: number; onOffer: boolean; discountPct: number; offerEndsAt: string };
    expect(prod.onOffer).toBe(true);
    expect(Number(prod.effectivePrice)).toBe(75000);
    expect(prod.discountPct).toBe(25);
    expect(prod.offerEndsAt).toBeTruthy();
  });

  it("quitar la oferta (promo 0) vuelve al precio base", async () => {
    const r = await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 0 });
    expect(r.status).toBe(200);

    const detail = await request(app).get(`/api/stores/${storeSlug}`);
    const prod = (detail.body.products as unknown[]).find(
      (p) => (p as { id: string }).id === productId,
    ) as { effectivePrice: number; onOffer: boolean; discountPct: number };
    expect(prod.onOffer).toBe(false);
    expect(Number(prod.effectivePrice)).toBe(100000);
    expect(prod.discountPct).toBe(0);
  });

  it("oferta vencida se ignora y el precio vuelve solo (sin cron)", async () => {
    // La API no deja crear vencidas; simulamos el paso del tiempo directo en DB.
    const ends = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await request(app)
      .patch(`/api/products/${productId}`)
      .set(await authHeaders())
      .send({ offerPrice: 60000, offerEndsAt: ends });
    await db
      .update(products)
      .set({ offerEndsAt: new Date(Date.now() - 60_000) })
      .where(eq(products.id, productId));

    const detail = await request(app).get(`/api/stores/${storeSlug}`);
    const prod = (detail.body.products as unknown[]).find(
      (p) => (p as { id: string }).id === productId,
    ) as { effectivePrice: number; onOffer: boolean };
    expect(prod.onOffer).toBe(false);
    expect(Number(prod.effectivePrice)).toBe(100000);
  });
});
