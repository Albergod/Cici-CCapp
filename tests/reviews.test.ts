import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, storeReviews } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `rev-owner-${ts}@example.com`;
const customerEmail = `rev-cust-${ts}@example.com`;
let ownerToken = "";
let customerToken = "";
let storeId = "";
let storeSlug = "";

describe("Reseñas: prueba social con foto", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    for (const [email, name] of [[ownerEmail, "Owner"], [customerEmail, "Cust"]] as const) {
      await request(app).post("/api/auth/register").send({ email, password: "demo123456", name, termsAccepted: true });
    }
    ownerToken = (await request(app).post("/api/auth/login").send({ email: ownerEmail, password: "demo123456" })).body.token;
    customerToken = (await request(app).post("/api/auth/login").send({ email: customerEmail, password: "demo123456" })).body.token;

    const s = await request(app).post("/api/stores").set("Authorization", `Bearer ${ownerToken}`).send({
      name: `Reviews ${ts}`, businessType: "ROPA",
    });
    storeId = s.body.id;
    storeSlug = s.body.slug;
    await request(app).post(`/api/stores/${storeId}/products`).set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Chaqueta", price: 120000, stock: 5,
    });
  });

  afterAll(async () => {
    await db.delete(storeReviews).where(eq(storeReviews.storeId, storeId));
    const prods = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId));
    if (prods.length) await db.delete(products).where(inArray(products.id, prods.map((p) => p.id)));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
    await db.delete(users).where(eq(users.email, customerEmail));
  });

  it("la dueña no puede calificar su propia tienda", async () => {
    const r = await request(app).post(`/api/stores/${storeId}/reviews`).set("Authorization", `Bearer ${ownerToken}`).send({
      rating: 5, comment: "Mi tienda es la mejor",
    });
    expect(r.status).toBe(400);
  });

  it("clienta publica reseña con foto y el detalle la promedia", async () => {
    const r = await request(app).post(`/api/stores/${storeId}/reviews`).set("Authorization", `Bearer ${customerToken}`).send({
      rating: 4, comment: "Buena atención", imageUrl: "/uploads/foto-test.jpg",
    });
    expect(r.status).toBe(201);
    expect(r.body.review.imageUrl).toBe("/uploads/foto-test.jpg");

    const detail = await request(app).get(`/api/stores/${storeSlug}`);
    expect(Number(detail.body.ratingAvg)).toBe(4);
    expect(detail.body.ratingCount).toBe(1);

    const list = await request(app).get(`/api/stores/${storeId}/reviews`);
    expect(list.body.reviews.length).toBe(1);
    expect(list.body.reviews[0].customer.name).toBe("Cust");
  });

  it("re-publicar actualiza (upsert: una por clienta y tienda)", async () => {
    await request(app).post(`/api/stores/${storeId}/reviews`).set("Authorization", `Bearer ${customerToken}`).send({
      rating: 5, comment: "Mejoró",
    });
    const list = await request(app).get(`/api/stores/${storeId}/reviews`);
    expect(list.body.reviews.length).toBe(1);
    expect(list.body.ratingAvg).toBe(5);
  });

  it("rating fuera de 1-5 se rechaza", async () => {
    const r = await request(app).post(`/api/stores/${storeId}/reviews`).set("Authorization", `Bearer ${customerToken}`).send({
      rating: 9,
    });
    expect(r.status).toBe(400);
  });
});
