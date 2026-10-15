import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, sales, saleItems } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `stock-${ts}@example.com`;
let token = "";
let storeId = "";
let productId = "";

describe("Stock: agotado automático con aviso", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    await request(app).post("/api/auth/register").send({
      email, password: "demo123456", name: "Stock", termsAccepted: true,
    });
    token = (await request(app).post("/api/auth/login").send({ email, password: "demo123456" })).body.token;
    const s = await request(app).post("/api/stores").set("Authorization", `Bearer ${token}`).send({
      name: `Stock ${ts}`, businessType: "ROPA",
    });
    storeId = s.body.id;
    // Trial para poder vender (plan de pago o trial abre ventas).
    await request(app).post(`/api/stores/${storeId}/products`).set("Authorization", `Bearer ${token}`).send({
      name: "Gorra", price: 30000, stock: 5,
    });
    await request(app).post(`/api/stores/${storeId}/trial`).set("Authorization", `Bearer ${token}`);
    const p = await request(app).post(`/api/stores/${storeId}/products`).set("Authorization", `Bearer ${token}`).send({
      name: "Gorra", price: 30000, stock: 2,
    });
    productId = p.body.id;
  });

  afterAll(async () => {
    const items = await db.select({ id: saleItems.id }).from(saleItems).where(eq(saleItems.productId, productId));
    if (items.length) await db.delete(saleItems).where(inArray(saleItems.id, items.map((i) => i.id)));
    const ss = await db.select({ id: sales.id }).from(sales).where(eq(sales.storeId, storeId));
    for (const s of ss) await db.delete(sales).where(eq(sales.id, s.id));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, email));
  });

  it("vender las últimas unidades desactiva el producto (aviso a la dueña)", async () => {
    const sale = await request(app).post("/api/sales").set("Authorization", `Bearer ${token}`).send({
      items: [{ productId, quantity: 2 }],
    });
    expect(sale.status).toBe(201);
    const [p] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    expect(Number(p!.stock)).toBe(0);
    expect(p!.available).toBe(false);
  });
});
