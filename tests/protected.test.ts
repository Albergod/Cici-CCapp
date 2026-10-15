import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, orders, orderItems, violations, protectedPayments } from "../src/db/schema";
import { canTransition, payoutReport, releaseDueProtected, splitFees, storeBalance } from "../src/lib/protected";
import { createPendingOrder } from "../src/lib/orders";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `prot-owner-${ts}@example.com`;
const customerEmail = `prot-cust-${ts}@example.com`;
let ownerToken = "";
let customerToken = "";
let storeId = "";
let orderId = "";

async function register(email: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "Prot",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

describe("Pago protegido piloto", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
    ownerToken = await register(ownerEmail);
    customerToken = await register(customerEmail);

    const s = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Protegida ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = s.body.id;
    await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));

    await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Ruana", price: 100000, stock: 5 });

    const created = await createPendingOrder({
      storeId,
      customerId: (
        await db.select({ id: users.id }).from(users).where(eq(users.email, customerEmail)).limit(1)
      )[0]!.id,
      productName: "Ruana",
      quantity: 1,
    });
    if (!created.ok) throw new Error("no se pudo crear el pedido de prueba");
    orderId = created.orderId;
  });

  afterAll(async () => {
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    for (const o of ords) {
      await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    }
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    await db.delete(violations).where(eq(violations.storeId, storeId));
    for (const o of ords) {
      await db.delete(orders).where(eq(orders.id, o.id));
    }
    const prods = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId));
    if (prods.length) await db.delete(products).where(inArray(products.id, prods.map((p) => p.id)));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
    await db.delete(users).where(eq(users.email, customerEmail));
  });

  it("matemática 2.5/2.5 en COP enteros", () => {
    const s = splitFees(100000);
    expect(s.charge).toBe(102500);
    expect(s.sellerNet).toBe(97500);
    expect(s.buyerFee).toBe(2500);
    expect(s.sellerFee).toBe(2500);
    expect(s.charge - s.sellerNet).toBe(s.buyerFee + s.sellerFee);
  });

  it("máquina de estados: solo avanza o devuelve", () => {
    expect(canTransition("initiated", "collected")).toBe(true);
    expect(canTransition("held", "released")).toBe(true);
    expect(canTransition("released", "paid_out")).toBe(true);
    expect(canTransition("held", "refunded")).toBe(true);
    expect(canTransition("initiated", "paid_out")).toBe(false);
    expect(canTransition("paid_out", "refunded")).toBe(false);
    expect(canTransition("refunded", "released")).toBe(false);
  });

  it("checkout exige tienda voluntaria y cliente dueño del pedido", async () => {
    await db.update(stores).set({ protectedEnabled: false }).where(eq(stores.id, storeId));
    const off = await request(app)
      .post("/api/protected/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderId, phoneNumber: "3101234567" });
    expect(off.status).toBe(403);
    await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));

    const other = await request(app)
      .post("/api/protected/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId, phoneNumber: "3101234567" });
    expect(other.status).toBe(403);
  });

  it("sin Wompi configurado avisa 503 (no rompe validación)", async () => {
    if (process.env.WOMPI_PRIVATE_KEY) return; // con llaves reales no aplica
    const r = await request(app)
      .post("/api/protected/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderId, phoneNumber: "3101234567" });
    expect(r.status).toBe(503);
  });

  it("cron libera lo retenido +48h y el reporte cuadra", async () => {    const [me] = await db.select({ id: users.id }).from(users).where(eq(users.email, customerEmail)).limit(1);
    const [row] = await db
      .insert(protectedPayments)
      .values({
        orderId,
        storeId,
        customerId: me!.id,
        total: "100000",
        buyerFee: "2500",
        sellerFee: "2500",
        collected: "102500",
        sellerNet: "97500",
        status: "held",
      })
      .returning();
    // Envejecer la retención más de 48h.
    await db
      .update(protectedPayments)
      .set({ createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000) })
      .where(eq(protectedPayments.id, row.id));

    const n = await releaseDueProtected();
    expect(n).toBeGreaterThanOrEqual(1);

    const rep = await payoutReport();
    expect(rep.some((r) => r.id === row.id)).toBe(true);
    const bal = await storeBalance(storeId);
    expect(bal.pending).toBeGreaterThanOrEqual(97500);

    // La dueña marca el Nequi manual como pagado.
    const paid = await request(app)
      .post(`/api/protected/${row.id}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(paid.status).toBe(200);
    const bal2 = await storeBalance(storeId);
    expect(bal2.paid).toBeGreaterThanOrEqual(97500);
  });
  it("mis compras: la clienta ve sus pedidos con estado protegido", async () => {
    const r = await request(app).get("/api/orders/mine").set("Authorization", `Bearer ${customerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(1);
    expect(r.body[0].protectedStatus).toBeDefined();
  });

  it("lista de tendera incluye protectedStatus por pedido", async () => {
    const r = await request(app).get("/api/orders").set("Authorization", `Bearer ${ownerToken}`);
    expect(r.status).toBe(200);
    const withProt = (r.body as unknown[]).filter(
      (o) => (o as { protectedStatus: string | null }).protectedStatus !== null,
    );
    expect(withProt.length).toBeGreaterThanOrEqual(1);
  });

  it("disputa congela la liberación y no se duplica", async () => {
    // Pedido + pago retenido propio para disputar.
    const [me] = await db.select({ id: users.id }).from(users).where(eq(users.email, customerEmail)).limit(1);
    const [prod] = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId)).limit(1);
    const [order] = await db.insert(orders).values({ storeId, customerId: me!.id, status: "pending" }).returning();
    await db.insert(orderItems).values({ orderId: order.id, productId: prod!.id, name: "Ruana", unitPrice: "100000", quantity: "1" });
    await db.insert(protectedPayments).values({
      orderId: order.id, storeId, customerId: me!.id, total: "100000", buyerFee: "2500",
      sellerFee: "2500", collected: "102500", sellerNet: "97500", status: "held",
    });
    const bad = await request(app).post("/api/protected/dispute").set("Authorization", `Bearer ${customerToken}`).send({
      orderId: order.id, reason: "corto",
    });
    expect(bad.status).toBe(400);
    const ok = await request(app).post("/api/protected/dispute").set("Authorization", `Bearer ${customerToken}`).send({
      orderId: order.id, reason: "Pagué hace días y no me ha llegado nada del pedido.",
    });
    expect(ok.status).toBe(201);
    const dup = await request(app).post("/api/protected/dispute").set("Authorization", `Bearer ${customerToken}`).send({
      orderId: order.id, reason: "Otra vez lo mismo con más letras.",
    });
    expect(dup.status).toBe(409);
    // El cron NO libera lo disputado aunque pase el tiempo.
    await db.update(protectedPayments).set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(protectedPayments.orderId, order.id));
    await releaseDueProtected();
    const [row] = await db.select({ status: protectedPayments.status }).from(protectedPayments).where(eq(protectedPayments.orderId, order.id)).limit(1);
    expect(row!.status).toBe("held");
  });
});
