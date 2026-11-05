import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  users,
  stores,
  products,
  orders,
  orderItems,
  protectedPayments,
  violations,
  sales,
  saleItems,
} from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `guest-owner-${ts}@example.com`;
const guestEmail = `guest-buyer-${ts}@example.com`;
let ownerToken = "";
let storeId = "";
let productId = "";

// Correos "enviados" por Resend (mock de fetch).
const sentEmails: Array<{ to: string[]; subject: string; html?: string }> = [];

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

async function register(email: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "Guest Test",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

function guestBody(overrides: Record<string, unknown> = {}) {
  return {
    storeId,
    items: [{ productId, quantity: 1 }],
    email: guestEmail,
    phone: "3101234567",
    name: "Compradora Invitada",
    paymentMethod: "NEQUI_DIRECTO",
    ...overrides,
  };
}

describe("Compra de invitado (sin cuenta) — pago directo por Nequi", () => {
  beforeAll(async () => {
    // Email activo para este archivo: Resend se mockea con fetch.
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_guest_checkout";

    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://api.resend.com/emails") {
        const body = JSON.parse(String(init?.body)) as {
          from?: string;
          to: string[];
          subject: string;
          html?: string;
          text?: string;
        };
        sentEmails.push(body);
        return jsonResponse({ id: "res_test_" + Date.now() });
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "not found",
      } as unknown as Response;
    });

    ownerToken = await register(ownerEmail);
    const s = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Guest ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = s.body.id;
    await db
      .update(stores)
      .set({ paymentNequi: "3001234567" })
      .where(eq(stores.id, storeId));
    const p = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Vestido", price: 50000, stock: 5 });
    productId = p.body.id;
  });

  beforeEach(async () => {
    sentEmails.length = 0;
    // Stock amplio por defecto; cada test que necesite inventario ajustado lo
    // fija explícitamente.
    await db
      .update(products)
      .set({ stock: "50", available: true })
      .where(eq(products.id, productId));
    await db.update(stores).set({ paymentNequi: "3001234567" }).where(eq(stores.id, storeId));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(violations).where(eq(violations.storeId, storeId));
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    for (const o of ords) await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    for (const o of ords) await db.delete(orders).where(eq(orders.id, o.id));
    const sals = await db.select({ id: sales.id }).from(sales).where(eq(sales.storeId, storeId));
    for (const s of sals) await db.delete(saleItems).where(eq(saleItems.saleId, s.id));
    for (const s of sals) await db.delete(sales).where(eq(sales.id, s.id));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
  });

  it("crea el pedido directo, calcula el precio en el servidor y envía el código al comprador y aviso al comerciante", async () => {
    const r = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 2 }] }));
    expect(r.status).toBe(201);
    expect(r.body.guestCode).toMatch(/^[A-F0-9]{32}$/);
    expect(r.body.paymentMethod).toBe("NEQUI_DIRECTO");
    expect(r.body.emailed).toBe(true);
    expect(r.body.total).toBe(100000);
    expect(r.body.charge).toBe(100000);
    expect(r.body.sellerNet).toBe(100000);
    expect(r.body.directNequi.phone).toBe("3001234567");
    expect(r.body.payment).toBeNull();

    const [order] = await db.select().from(orders).where(eq(orders.id, r.body.orderId)).limit(1);
    expect(order!.customerId).toBeNull();
    expect(order!.customerEmail).toBe(guestEmail);
    expect(order!.guestCodeHash).toBeTruthy();
    expect(order!.guestCodeHash).not.toBe(r.body.guestCode);
    expect(order!.paymentMethod).toBe("NEQUI_DIRECTO");

    // Sin custodia: no se crea registro de pago protegido.
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, r.body.orderId))
      .limit(1);
    expect(pay).toBeUndefined();

    // El stock se reservó al crear el pedido (50 - 2).
    const [prod] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(prod!.stock)).toBe(48);

    // Email al comprador con el código.
    const toBuyer = sentEmails.find((e) => e.to.includes(guestEmail));
    expect(toBuyer).toBeTruthy();
    expect(toBuyer!.subject).toContain("está listo");
    expect(toBuyer!.html).toContain(r.body.guestCode);
    expect(toBuyer!.html).toContain("3001234567");

    // Email al comerciante avisando del nuevo pedido.
    const toMerchant = sentEmails.find((e) => e.to.includes(ownerEmail));
    expect(toMerchant).toBeTruthy();
    expect(toMerchant!.subject).toContain("Nuevo pedido por Nequi");
  });

  it("consulta con email + código; un código incorrecto no revela nada", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);

    const wrong = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=00000000000000000000000000000000`,
    );
    expect(wrong.status).toBe(404);

    const otherEmail = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(`otro-${ts}@example.com`)}&code=${created.body.guestCode}`,
    );
    expect(otherEmail.status).toBe(404);

    const ok = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${created.body.guestCode}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.orderId).toBe(created.body.orderId);
    expect(ok.body.items[0].name).toBe("Vestido");
    expect(ok.body.payment).toBeNull();
    expect(ok.body.paymentMethod).toBe("NEQUI_DIRECTO");
    expect(ok.body.store.paymentNequi).toBe("3001234567");
  });

  it("rechaza los métodos viejos de Wompi/PSE (solo Nequi directo)", async () => {
    const nequi = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ paymentMethod: "NEQUI", phoneNumber: "3001234567" }));
    expect(nequi.status).toBe(410);
    expect(nequi.body.code).toBe("direct_only");

    const pse = await request(app).post("/api/orders/guest").send(
      guestBody({
        paymentMethod: "PSE",
        pse: {
          userType: 0,
          legalIdType: "CC",
          legalId: "1234567890",
          financialInstitutionCode: "1",
          fullName: "Compradora Invitada",
        },
      }),
    );
    expect(pse.status).toBe(410);
    expect(pse.body.code).toBe("direct_only");
  });

  it("valida stock, producto y tienda sin Nequi configurado", async () => {
    await db.update(products).set({ stock: "5" }).where(eq(products.id, productId));
    const overStock = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 6 }] }));
    expect(overStock.status).toBe(409);
    expect(overStock.body.code).toBe("insufficient_stock");

    const missingProduct = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }] }));
    expect(missingProduct.status).toBe(404);

    await db.update(stores).set({ paymentNequi: null }).where(eq(stores.id, storeId));
    const noChannel = await request(app).post("/api/orders/guest").send(guestBody());
    expect(noChannel.status).toBe(409);
    expect(noChannel.body.code).toBe("no_nequi_channel");

    await db.update(stores).set({ paymentNequi: "3001234567" }).where(eq(stores.id, storeId));
  });

  it("el comprador avisa 'ya pagué' sin confirmar la venta y se avisa al comerciante", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);

    const before = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${created.body.guestCode}`,
    );
    expect(before.body.buyerReportedPaidAt).toBeNull();

    const paid = await request(app)
      .post("/api/orders/guest/paid")
      .send({ email: guestEmail, code: created.body.guestCode });
    expect(paid.status).toBe(200);
    expect(paid.body.ok).toBe(true);

    const [reported] = await db
      .select({ status: orders.status, reportedAt: orders.buyerReportedPaidAt })
      .from(orders)
      .where(eq(orders.id, created.body.orderId))
      .limit(1);
    expect(reported!.status).toBe("pending");
    expect(reported!.reportedAt).toBeTruthy();

    const afterPaid = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${created.body.guestCode}`,
    );
    expect(afterPaid.body.buyerReportedPaidAt).toBeTruthy();

    // Email al comerciante de "el comprador dice que ya pagó".
    const toMerchant = sentEmails.find((e) => e.to.includes(ownerEmail) && e.subject.includes("ya pagó"));
    expect(toMerchant).toBeTruthy();

    // Un código inválido no revela ni permite marcar el pedido.
    const badCode = await request(app)
      .post("/api/orders/guest/paid")
      .send({ email: guestEmail, code: "CICI-NOEXISTE" });
    expect(badCode.status).toBe(404);
  });

  it("resend-code rota el código del pedido pendiente más reciente y envía email", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);
    const oldCode = created.body.guestCode;

    // El código antiguo todavía funciona.
    const before = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${oldCode}`,
    );
    expect(before.status).toBe(200);

    // Solicitar reenvío: genera un código nuevo (rota el hash).
    const resend = await request(app)
      .post("/api/orders/guest/resend-code")
      .send({ email: guestEmail });
    expect(resend.status).toBe(200);
    expect(resend.body.ok).toBe(true);
    expect(resend.body.message).toContain("compra pendiente");

    // Se envió un email con el nuevo código.
    const toBuyer = sentEmails.find((e) => e.to.includes(guestEmail) && e.subject.includes("listo"));
    expect(toBuyer).toBeTruthy();

    // El código antiguo dejó de funcionar.
    const after = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${oldCode}`,
    );
    expect(after.status).toBe(404);
  });

  it("resend-code con email desconocido responde igual y no envía nada", async () => {
    const beforeCount = sentEmails.length;
    const resend = await request(app)
      .post("/api/orders/guest/resend-code")
      .send({ email: `nadie-${ts}@example.com` });
    expect(resend.status).toBe(200);
    expect(resend.body.ok).toBe(true);
    expect(resend.body.message).toContain("compra pendiente");
    expect(sentEmails.length).toBe(beforeCount);
  });

  it("reserva stock al crear y evita la sobreventa de la última unidad", async () => {
    await db.update(products).set({ stock: "1", available: true }).where(eq(products.id, productId));

    const first = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 1 }] }));
    expect(first.status).toBe(201);

    let [prod] = await db
      .select({ stock: products.stock, available: products.available })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(prod!.stock)).toBe(0);
    expect(prod!.available).toBe(false);

    // Segunda compra de la misma unidad: ya no hay stock, aunque sea otro invitado.
    const second = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ email: `otro-${ts}@example.com`, items: [{ productId, quantity: 1 }] }));
    expect(second.status).toBe(409);
    expect(["insufficient_stock", "product_unavailable"]).toContain(second.body.code);

    // Cancelar el pedido devuelve la reserva y reactiva el producto.
    const cancel = await request(app)
      .post(`/api/orders/${first.body.orderId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    [prod] = await db
      .select({ stock: products.stock, available: products.available })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(prod!.stock)).toBe(1);
    expect(prod!.available).toBe(true);

    // Ahora sí puede comprarla el segundo invitado.
    const retry = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ email: `otro-${ts}@example.com`, items: [{ productId, quantity: 1 }] }));
    expect(retry.status).toBe(201);
  });

  it("confirmar un pedido con stock reservado no lo descuenta dos veces", async () => {
    await db.update(products).set({ stock: "10", available: true }).where(eq(products.id, productId));

    const created = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 2 }] }));
    expect(created.status).toBe(201);

    let [prod] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(prod!.stock)).toBe(8); // reserva al crear

    const confirm = await request(app)
      .post(`/api/orders/${created.body.orderId}/confirm`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("sold");
    expect(confirm.body.saleId).toBeTruthy();

    [prod] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(prod!.stock)).toBe(8); // la venta no vuelve a descontar

    const [order] = await db
      .select({ status: orders.status, stockReserved: orders.stockReserved })
      .from(orders)
      .where(eq(orders.id, created.body.orderId))
      .limit(1);
    expect(order!.status).toBe("sold");
    expect(order!.stockReserved).toBe(false);
  });

  it("el invitado puede reportar un problema con email + código (sin duplicados)", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);

    const wrong = await request(app)
      .post("/api/orders/guest/report")
      .send({ email: guestEmail, code: "NOEXISTE", reason: "No me llegó el pedido" });
    expect(wrong.status).toBe(404);

    const report = await request(app)
      .post("/api/orders/guest/report")
      .send({ email: guestEmail, code: created.body.guestCode, reason: "No me llegó el pedido" });
    expect(report.status).toBe(201);
    expect(report.body.ok).toBe(true);
    expect(report.body.action).toBe("none");
    expect(report.body.message).toContain("revisará");

    const [row] = await db
      .select({ type: violations.type, reason: violations.reason, metadata: violations.metadata })
      .from(violations)
      .where(eq(violations.storeId, storeId))
      .limit(1);
    expect(row!.type).toBe("buyer_report");
    expect(row!.reason).toContain("No me llegó el pedido");
    expect((row!.metadata as Record<string, unknown>).orderId).toBe(created.body.orderId);

    // Un mismo pedido no dispara dos reportes (evita sanciones por duplicado).
    const duplicate = await request(app)
      .post("/api/orders/guest/report")
      .send({ email: guestEmail, code: created.body.guestCode, reason: "Insisto, no llegó" });
    expect(duplicate.status).toBe(429);
  });

  it("sin email configurado, resend-code NO rota el código (evita dejarlo sin acceso)", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);
    const code = created.body.guestCode;

    const prevProvider = process.env.EMAIL_PROVIDER;
    const prevKey = process.env.RESEND_API_KEY;
    try {
      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      const resend = await request(app)
        .post("/api/orders/guest/resend-code")
        .send({ email: guestEmail });
      expect(resend.status).toBe(503);
      expect(resend.body.code).toBe("email_not_configured");
    } finally {
      if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
      else delete process.env.EMAIL_PROVIDER;
      if (prevKey) process.env.RESEND_API_KEY = prevKey;
      else delete process.env.RESEND_API_KEY;
    }

    // El código anterior sigue sirviendo.
    const after = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${code}`,
    );
    expect(after.status).toBe(200);
  });
});
