import "./wompi-env";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  users,
  stores,
  products,
  orders,
  orderItems,
  protectedPayments,
  ledgerEntries,
  payments,
} from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `guest-owner-${ts}@example.com`;
const guestEmail = `guest-buyer-${ts}@example.com`;
let ownerToken = "";
let storeId = "";
let productId = "";
let counter = 0;

type Tx = {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  payment_method: { type: string; extra?: { async_payment_url?: string } };
};
const txs = new Map<string, Tx>();

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

const pse = {
  userType: 0,
  legalIdType: "CC",
  legalId: "1234567890",
  financialInstitutionCode: "1",
  fullName: "Compradora Invitada",
};

function guestBody(overrides: Record<string, unknown> = {}) {
  return {
    storeId,
    items: [{ productId, quantity: 1 }],
    email: guestEmail,
    phone: "3101234567",
    name: "Compradora Invitada",
    paymentMethod: "PSE",
    pse,
    ...overrides,
  };
}

describe("Compra de invitado (sin cuenta)", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/merchants/")) {
        return jsonResponse({
          data: {
            presigned_acceptance: { acceptance_token: "acc-token" },
            presigned_personal_data_auth: { acceptance_token: "pda-token" },
          },
        });
      }
      if (u.includes("/pse/financial_institutions")) {
        return jsonResponse({ data: [{ financial_institution_code: "1", financial_institution_name: "Banco Uno" }] });
      }
      const match = u.match(/\/transactions\/([^/?]+)$/);
      if (match && method === "GET") {
        return jsonResponse({ data: txs.get(decodeURIComponent(match[1])) ?? null });
      }
      if (u.endsWith("/transactions") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          amount_in_cents: number;
          reference: string;
          payment_method: { type: string };
        };
        const id = `guesttx-${ts}-${++counter}`;
        const type = body.payment_method?.type ?? "NEQUI";
        const tx: Tx = {
          id,
          status: "PENDING",
          reference: body.reference,
          amount_in_cents: body.amount_in_cents,
          payment_method: {
            type,
            extra: type === "PSE" ? { async_payment_url: "https://banco.test/guest" } : {},
          },
        };
        txs.set(id, tx);
        return jsonResponse({ data: tx });
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" } as unknown as Response;
    });

    ownerToken = await register(ownerEmail);
    const s = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Guest ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = s.body.id;
    await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));
    const p = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Vestido", price: 50000, stock: 5 });
    productId = p.body.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    await db.delete(ledgerEntries).where(eq(ledgerEntries.storeId, storeId));
    await db.delete(payments).where(eq(payments.storeId, storeId));
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    for (const o of ords) await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    for (const o of ords) await db.delete(orders).where(eq(orders.id, o.id));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
  });

  it("crea el pedido sin sesión, calcula el precio en el servidor y devuelve código una vez", async () => {
    const r = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 2 }] }));
    expect(r.status).toBe(201);
    expect(r.body.guestCode).toMatch(/^[A-F0-9]{32}$/);
    expect(r.body.payment.redirectUrl).toBe("https://banco.test/guest");
    expect(r.body.total).toBe(100000);
    expect(r.body.charge).toBe(102500);

    const [order] = await db.select().from(orders).where(eq(orders.id, r.body.orderId)).limit(1);
    expect(order!.customerId).toBeNull();
    expect(order!.customerEmail).toBe(guestEmail);
    expect(order!.guestCodeHash).toBeTruthy();
    expect(order!.guestCodeHash).not.toBe(r.body.guestCode);

    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, r.body.orderId))
      .limit(1);
    expect(pay!.paymentMethod).toBe("PSE");
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
    expect(ok.body.payment.method).toBe("PSE");
    expect(ok.body.payment.status).toBe("initiated");
  });

  it("al aprobar en Wompi, la consulta de invitado refleja el pago y registra ledger", async () => {
    const created = await request(app).post("/api/orders/guest").send(guestBody());
    expect(created.status).toBe(201);
    const txId = created.body.payment.transactionId as string;

    txs.get(txId)!.status = "APPROVED";
    const status = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${created.body.guestCode}`,
    );
    expect(status.status).toBe(200);
    expect(status.body.payment.status).toBe("held");

    const [pay] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, "WOMPI"), eq(payments.providerTransactionId, txId)))
      .limit(1);
    expect(pay).toBeTruthy();
    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.paymentId, pay!.id), eq(ledgerEntries.entryType, "SALE")))
      .limit(1);
    expect(entry).toBeTruthy();
    expect(Number(entry!.amount)).toBe(50000);
  });

  it("valida método, stock y tienda sin pago en línea", async () => {
    const noPhone = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ paymentMethod: "NEQUI", pse: undefined, phoneNumber: undefined }));
    expect(noPhone.status).toBe(400);

    const overStock = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId, quantity: 6 }] }));
    expect(overStock.status).toBe(409);
    expect(overStock.body.code).toBe("insufficient_stock");

    const missingProduct = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ items: [{ productId: crypto.randomUUID(), quantity: 1 }] }));
    expect(missingProduct.status).toBe(404);

    await db.update(stores).set({ protectedEnabled: false }).where(eq(stores.id, storeId));
    const disabled = await request(app).post("/api/orders/guest").send(guestBody());
    expect(disabled.status).toBe(409);
    await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));
  });

  it("pago directo: usa el Nequi del comerciante, sin custodia ni comisión", async () => {
    await db
      .update(stores)
      .set({ protectedEnabled: false, paymentNequi: "3001234567" })
      .where(eq(stores.id, storeId));

    const r = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ paymentMethod: "NEQUI_DIRECTO", pse: undefined }));
    expect(r.status).toBe(201);
    expect(r.body.paymentMethod).toBe("NEQUI_DIRECTO");
    expect(r.body.total).toBe(50000);
    expect(r.body.charge).toBe(50000);
    expect(r.body.sellerNet).toBe(50000);
    expect(r.body.directNequi.phone).toBe("3001234567");

    // Sin custodia: no se crea registro de pago protegido.
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, r.body.orderId))
      .limit(1);
    expect(pay).toBeUndefined();

    const status = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${r.body.guestCode}`,
    );
    expect(status.status).toBe(200);
    expect(status.body.payment).toBeNull();
    expect(status.body.store.paymentNequi).toBe("3001234567");
    expect(status.body.paymentMethod).toBe("NEQUI_DIRECTO");
    expect(status.body.buyerReportedPaidAt).toBeNull();

    // El comprador avisa "ya pagué": se marca (sin confirmar la venta) y el
    // comerciante lo ve en su panel para verificar el Nequi.
    const paid = await request(app)
      .post("/api/orders/guest/paid")
      .send({ email: guestEmail, code: r.body.guestCode });
    expect(paid.status).toBe(200);
    expect(paid.body.ok).toBe(true);

    const [reported] = await db
      .select({ status: orders.status, reportedAt: orders.buyerReportedPaidAt })
      .from(orders)
      .where(eq(orders.id, r.body.orderId))
      .limit(1);
    expect(reported?.status).toBe("pending");
    expect(reported?.reportedAt).toBeTruthy();

    const afterPaid = await request(app).get(
      `/api/orders/guest?email=${encodeURIComponent(guestEmail)}&code=${r.body.guestCode}`,
    );
    expect(afterPaid.body.buyerReportedPaidAt).toBeTruthy();

    // Un código inválido no revela ni permite marcar el pedido.
    const badCode = await request(app)
      .post("/api/orders/guest/paid")
      .send({ email: guestEmail, code: "CICI-NOEXISTE" });
    expect(badCode.status).toBe(404);

    // Sin Nequi configurado no se puede cobrar directo.
    await db.update(stores).set({ paymentNequi: null }).where(eq(stores.id, storeId));
    const noChannel = await request(app)
      .post("/api/orders/guest")
      .send(guestBody({ paymentMethod: "NEQUI_DIRECTO", pse: undefined }));
    expect(noChannel.status).toBe(409);
    expect(noChannel.body.code).toBe("no_nequi_channel");

    await db
      .update(stores)
      .set({ protectedEnabled: true, paymentNequi: "3001234567" })
      .where(eq(stores.id, storeId));
  });
});
