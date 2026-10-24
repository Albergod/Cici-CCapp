import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  users,
  stores,
  products,
  orders,
  orderItems,
  sales,
  saleItems,
  protectedPayments,
} from "../src/db/schema";
import { createPendingOrder } from "../src/lib/orders";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `fin-owner-${ts}@example.com`;
const customerEmail = `fin-customer-${ts}@example.com`;
let ownerToken = "";
let customerToken = "";
let ownerId = "";
let customerId = "";
let storeId = "";
let productId = "";

async function register(email: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "Fin",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return { token: login.body.token as string, id: row!.id as string };
}

async function addProduct(name: string, stock: number) {
  const res = await request(app)
    .post(`/api/stores/${storeId}/products`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name, price: 10000, stock });
  return res.body.id as string;
}

async function pendingOrder(productName: string, quantity: number) {
  const res = await createPendingOrder({
    storeId,
    customerId,
    productName,
    quantity,
  });
  if (!res.ok) throw new Error(`No se pudo crear el pedido: ${res.message}`);
  return res.orderId;
}

async function confirmedSaleCount(orderId: string) {
  const [row] = await db.select({ saleId: orders.saleId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!row?.saleId) return 0;
  const rows = await db.select({ id: sales.id }).from(sales).where(eq(sales.id, row.saleId));
  return rows.length;
}

describe("Integridad financiera: concurrencia real contra PostgreSQL", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    const owner = await register(ownerEmail);
    const customer = await register(customerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;
    customerToken = customer.token;
    customerId = customer.id;

    const s = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Fin ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = s.body.id;
    // El trial exige al menos un producto/servicio para activarse.
    productId = await addProduct("Inicial", 1);
    await request(app).post(`/api/stores/${storeId}/trial`).set("Authorization", `Bearer ${ownerToken}`);
  });

  afterAll(async () => {
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    const orderIds = ords.map((o) => o.id);
    if (orderIds.length) await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    // Primero los pedidos (FK orders.sale_id → sales), luego las ventas.
    if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
    const saleRows = await db.select({ id: sales.id }).from(sales).where(eq(sales.storeId, storeId));
    const saleIds = saleRows.map((s) => s.id);
    if (saleIds.length) await db.delete(saleItems).where(inArray(saleItems.saleId, saleIds));
    if (saleIds.length) await db.delete(sales).where(inArray(sales.id, saleIds));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(inArray(users.email, [ownerEmail, customerEmail]));
  });

  it("dos confirmaciones simultáneas del mismo pedido: una venta, un solo 200", async () => {
    const name = `Uno-${Date.now()}`;
    productId = await addProduct(name, 1);
    const orderId = await pendingOrder(name, 1);

    const [a, b] = await Promise.all([
      request(app).post(`/api/orders/${orderId}/confirm`).set("Authorization", `Bearer ${ownerToken}`),
      request(app).post(`/api/orders/${orderId}/confirm`).set("Authorization", `Bearer ${ownerToken}`),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await confirmedSaleCount(orderId)).toBe(1);
    const [order] = await db.select({ status: orders.status, saleId: orders.saleId }).from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(order!.status).toBe("sold");
    expect(order!.saleId).toBeTruthy();
  });

  it("dos pedidos por la última unidad: no se sobrevende y el segundo queda pendiente", async () => {
    const name = `Dos-${Date.now()}`;
    productId = await addProduct(name, 1);
    const orderA = await pendingOrder(name, 1);
    const orderB = await pendingOrder(name, 1);

    const [a, b] = await Promise.all([
      request(app).post(`/api/orders/${orderA}/confirm`).set("Authorization", `Bearer ${ownerToken}`),
      request(app).post(`/api/orders/${orderB}/confirm`).set("Authorization", `Bearer ${ownerToken}`),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId)).limit(1);
    expect(Number(product!.stock)).toBe(0);
    const rows = await db.select({ status: orders.status }).from(orders).where(inArray(orders.id, [orderA, orderB]));
    expect(rows.filter((r) => r.status === "sold")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  async function insertProtected(status: "held" | "released") {
    const name = `Prot-${Date.now()}-${Math.random()}`;
    await addProduct(name, 5);
    const orderId = await pendingOrder(name, 1);
    const [row] = await db
      .insert(protectedPayments)
      .values({
        orderId,
        storeId,
        customerId,
        total: "10000",
        buyerFee: "250",
        sellerFee: "250",
        collected: "10250",
        sellerNet: "9750",
        status,
        ...(status === "released" ? { releasedAt: new Date() } : {}),
      })
      .returning();
    return row!;
  }

  it("liberar dos veces a la vez: una sola transición gana", async () => {
    const row = await insertProtected("held");
    const [a, b] = await Promise.all([
      request(app).post(`/api/protected/${row.id}/release`).set("Authorization", `Bearer ${ownerToken}`),
      request(app).post(`/api/protected/${row.id}/release`).set("Authorization", `Bearer ${ownerToken}`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [fresh] = await db.select({ status: protectedPayments.status }).from(protectedPayments).where(eq(protectedPayments.id, row.id)).limit(1);
    expect(fresh!.status).toBe("released");
  });

  it("mark-paid es idempotente y deja auditoría (quién y referencia)", async () => {
    const row = await insertProtected("released");
    const first = await request(app)
      .post(`/api/protected/${row.id}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ payoutReference: "NEQUI-ABC-123" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/protected/${row.id}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ payoutReference: "NEQUI-ABC-123" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const [fresh] = await db.select().from(protectedPayments).where(eq(protectedPayments.id, row.id)).limit(1);
    expect(fresh!.status).toBe("paid_out");
    expect(fresh!.paidOutBy).toBe(ownerId);
    expect(fresh!.payoutReference).toBe("NEQUI-ABC-123");
  });

  it("admin: el token estático ya no entra por X-Admin-Token; solo por JWT", async () => {
    const bootstrap = process.env.ADMIN_TOKEN;
    if (!bootstrap) return;

    const bad = await request(app).post("/api/admin/login").send({ token: "incorrecto" });
    expect(bad.status).toBe(403);

    const login = await request(app).post("/api/admin/login").send({ token: bootstrap });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const legacy = await request(app).get("/api/stores/admin/stats").set("X-Admin-Token", bootstrap);
    expect(legacy.status).toBe(401);

    const withJwt = await request(app).get("/api/stores/admin/stats").set("Authorization", `Bearer ${login.body.token}`);
    expect(withJwt.status).toBe(200);
  });

  it("CORS y cabeceras: origen ajeno sin permiso y helmet activo", async () => {
    const res = await request(app).get("/api/stores").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeTruthy();
  });
});
