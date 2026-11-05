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

  beforeEach(() => {
    sentEmails.length = 0;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    for (const o of ords) await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    for (const o of ords) await db.delete(orders).where(eq(orders.id, o.id));
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
});
