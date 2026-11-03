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
  payouts,
  ledgerEntries,
  payments,
  merchantBankAccounts,
  paymentWebhookEvents,
} from "../src/db/schema";
import { createPendingOrder } from "../src/lib/orders";
import { balanceForStore, entriesForPayment } from "../src/lib/ledger";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const ownerEmail = `pay-owner-${ts}@example.com`;
const customerEmail = `pay-cust-${ts}@example.com`;
let ownerToken = "";
let customerToken = "";
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
    name: "Pay Test",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

async function makeOrder(): Promise<string> {
  const [customer] = await db.select({ id: users.id }).from(users).where(eq(users.email, customerEmail)).limit(1);
  const created = await createPendingOrder({
    storeId,
    customerId: customer!.id,
    productName: "Blusa",
    quantity: 1,
  });
  if (!created.ok) throw new Error("no se pudo crear el pedido");
  return created.orderId;
}

async function pseCheckout(orderId: string) {
  return request(app)
    .post("/api/protected/checkout")
    .set("Authorization", `Bearer ${customerToken}`)
    .send({
      orderId,
      paymentMethod: "PSE",
      pse: {
        userType: 0,
        legalIdType: "CC",
        legalId: "1234567890",
        financialInstitutionCode: "1",
        fullName: "Clienta Test",
      },
    });
}

async function approve(orderId: string, transactionId: string) {
  txs.get(transactionId)!.status = "APPROVED";
  return request(app)
    .get(`/api/protected/status?orderId=${orderId}`)
    .set("Authorization", `Bearer ${customerToken}`);
}

async function paymentRow(transactionId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, "WOMPI"), eq(payments.providerTransactionId, transactionId)))
    .limit(1);
  return row;
}

describe("Cici Payments: PSE, ledger y liquidaciones", () => {
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
        return jsonResponse({
          data: [
            { financial_institution_code: "1", financial_institution_name: "Banco Uno" },
            { financial_institution_code: "2", financial_institution_name: "Banco Dos" },
          ],
        });
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
        const id = `paytx-${ts}-${++counter}`;
        const type = body.payment_method?.type ?? "NEQUI";
        const tx: Tx = {
          id,
          status: "PENDING",
          reference: body.reference,
          amount_in_cents: body.amount_in_cents,
          payment_method: {
            type,
            extra: type === "PSE" ? { async_payment_url: "https://banco.test/pagar" } : {},
          },
        };
        txs.set(id, tx);
        return jsonResponse({ data: tx });
      }

      // Wompi Pagos a Terceros (sandbox): acepta el desembolso por defecto.
      if (u.includes("payouts.wompi.co/v1/payouts") && method === "POST") {
        return jsonResponse({ data: { id: `payout-auto-${++counter}`, status: "PROCESSING" } });
      }

      return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" } as unknown as Response;
    });

    ownerToken = await register(ownerEmail);
    customerToken = await register(customerEmail);
    const s = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Pagos ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = s.body.id;
    await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));
    const p = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Blusa", price: 100000, stock: 20 });
    productId = p.body.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(protectedPayments).where(eq(protectedPayments.storeId, storeId));
    await db.delete(ledgerEntries).where(eq(ledgerEntries.storeId, storeId));
    await db.delete(payouts).where(eq(payouts.storeId, storeId));
    await db.delete(payments).where(eq(payments.storeId, storeId));
    await db.delete(merchantBankAccounts).where(eq(merchantBankAccounts.storeId, storeId));
    const ords = await db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
    for (const o of ords) await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    for (const o of ords) await db.delete(orders).where(eq(orders.id, o.id));
    await db.delete(products).where(eq(products.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await db.delete(users).where(eq(users.email, ownerEmail));
    await db.delete(users).where(eq(users.email, customerEmail));
  });

  it("lista bancos PSE desde Wompi (sin cobrar)", async () => {
    const r = await request(app).get("/api/payments/wompi/pse/institutions");
    expect(r.status).toBe(200);
    expect(r.body.institutions).toEqual([
      { code: "1", name: "Banco Uno" },
      { code: "2", name: "Banco Dos" },
    ]);
  });

  it("PSE: crea cobro con URL del banco y registra ledger retenido al aprobar", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    expect(checkout.status).toBe(201);
    expect(checkout.body.paymentMethod).toBe("PSE");
    expect(checkout.body.redirectUrl).toBe("https://banco.test/pagar");
    expect(checkout.body.charge).toBe(102500);

    const txId = checkout.body.transactionId as string;
    const st = await approve(orderId, txId);
    expect(st.status).toBe(200);
    expect(st.body.status).toBe("held");

    const pay = await paymentRow(txId);
    expect(pay).toBeTruthy();
    expect(pay!.status).toBe("APPROVED");
    expect(pay!.paymentMethod).toBe("PSE");
    expect(Number(pay!.amount)).toBe(102500);

    const entries = await entriesForPayment(pay!.id);
    expect(entries).toHaveLength(2);
    const sale = entries.find((e) => e.entryType === "SALE")!;
    const commission = entries.find((e) => e.entryType === "COMMISSION")!;
    expect(Number(sale.amount)).toBe(100000);
    expect(Number(commission.amount)).toBe(-2500);
    expect(entries.every((e) => e.status === "PENDING")).toBe(true);

    const balance = await balanceForStore(storeId);
    expect(balance.pending).toBe(97500);
    expect(balance.available).toBe(0);
  });

  it("ledger es idempotente: volver a consultar el estado no duplica movimientos", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const pay = await paymentRow(txId);
    const before = await entriesForPayment(pay!.id);
    await approve(orderId, txId);
    await approve(orderId, txId);
    const after = await entriesForPayment(pay!.id);
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(2);
  });

  it("webhook firmado es idempotente: el evento duplicado no duplica el ledger", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    txs.get(txId)!.status = "APPROVED";
    const amount = txs.get(txId)!.amount_in_cents;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      event: "transaction.updated",
      data: {
        transaction: { id: txId, status: "APPROVED", amount_in_cents: amount },
      },
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
        timestamp,
        checksum: "",
      },
    };
    const raw = `${txId}APPROVED${amount}${timestamp}${process.env.WOMPI_EVENTS_KEY}`;
    const checksum = crypto.createHash("sha256").update(raw, "utf8").digest("hex").toUpperCase();

    await request(app)
      .post("/api/payments/wompi/webhook")
      .set("X-Event-Checksum", checksum)
      .send(payload);
    await request(app)
      .post("/api/payments/wompi/webhook")
      .set("X-Event-Checksum", checksum)
      .send(payload);

    // El webhook responde 200 y procesa después; esperamos el pago.
    let pay: Awaited<ReturnType<typeof paymentRow>> | undefined;
    for (let i = 0; i < 50 && !pay; i++) {
      pay = await paymentRow(txId);
      if (!pay) await new Promise((r) => setTimeout(r, 50));
    }
    expect(pay).toBeTruthy();
    const entries = await entriesForPayment(pay!.id);
    expect(entries).toHaveLength(2);

    const eventId = crypto
      .createHash("sha256")
      .update([payload.event, txId, "APPROVED", String(timestamp)].join("|"), "utf8")
      .digest("hex");
    const events = await db
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.eventId, eventId));
    expect(events).toHaveLength(1);
    await db.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, eventId));
  });

  it("cuenta bancaria: cifra el número y nunca lo devuelve", async () => {
    const created = await request(app)
      .post("/api/payouts/bank-accounts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        bankCode: "1",
        bankName: "Banco Uno",
        accountType: "AHORROS",
        accountNumber: "123456789012",
        holderName: "Dueña Test",
        holderDocType: "CC",
        holderDoc: "987654321",
        isDefault: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.accountLast4).toBe("9012");
    expect(JSON.stringify(created.body)).not.toContain("123456789012");

    const [row] = await db
      .select()
      .from(merchantBankAccounts)
      .where(eq(merchantBankAccounts.storeId, storeId))
      .limit(1);
    expect(row!.encryptedAccountNumber).not.toContain("123456789012");
    expect(row!.encryptedHolderDoc).not.toContain("987654321");

    const list = await request(app)
      .get("/api/payouts/bank-accounts")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain("123456789012");
  });

  it("release → available → payout → paid_out; sin doble liquidación", async () => {
    const before = await balanceForStore(storeId);
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);

    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);

    const released = await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(released.status).toBe(200);

    let balance = await balanceForStore(storeId);
    expect(balance.available - before.available).toBe(97500);
    expect(balance.pending).toBe(before.pending);

    const availableNow = balance.available;
    const requested = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(requested.status).toBe(201);
    const payoutId = requested.body.id as string;
    expect(Number(requested.body.amount)).toBe(availableNow);

    balance = await balanceForStore(storeId);
    expect(balance.available).toBe(before.available);
    expect(balance.inTransfer - before.inTransfer).toBe(availableNow - before.available);

    const second = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("no_balance");

    // Hueco cerrado: el mark-paid legacy no puede pagar un saldo ya
    // comprometido en una liquidación (doble desembolso).
    const legacy = await request(app)
      .post(`/api/protected/${pay!.id}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(legacy.status).toBe(409);

    const paid = await request(app)
      .post(`/api/payouts/${payoutId}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ providerPayoutId: "comprobante-1" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("SUCCESS");

    const again = await request(app)
      .post(`/api/payouts/${payoutId}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("SUCCESS");

    balance = await balanceForStore(storeId);
    expect(balance.inTransfer).toBe(0);
    expect(balance.paidOut).toBeGreaterThanOrEqual(97500);
  });

  it("fallo de payout devuelve el saldo a disponible (sin perder dinero)", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);
    await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const requested = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(requested.status).toBe(201);

    const failed = await request(app)
      .post(`/api/payouts/${requested.body.id}/fail`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Cuenta bloqueada" });
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe("FAILED");

    const balance = await balanceForStore(storeId);
    expect(balance.available).toBeGreaterThanOrEqual(97500);
    expect(balance.inTransfer).toBe(0);

    const retried = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(retried.status).toBe(201);
    expect(retried.body.status).toBe("PREPARED");

    const afterRetry = await balanceForStore(storeId);
    expect(afterRetry.available).toBe(0);
    expect(afterRetry.inTransfer).toBeGreaterThanOrEqual(97500);
  });

  it("refund revierte el ledger si el dinero no salió; lo bloquea si está en transferencia", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);

    await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const refunded = await request(app)
      .post(`/api/protected/${pay!.id}/refund`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(refunded.status).toBe(200);
    expect(refunded.body.status).toBe("refunded");

    const ledger = await entriesForPayment(pay!.paymentId!);
    expect(ledger.every((e) => e.status === "REVERSED")).toBe(true);

    // En transferencia: el reembolso se bloquea.
    const order2 = await makeOrder();
    const checkout2 = await pseCheckout(order2);
    await approve(order2, checkout2.body.transactionId);
    const [pay2] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, order2))
      .limit(1);
    await request(app)
      .post(`/api/protected/${pay2!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const req = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(req.status).toBe(201);

    const blocked = await request(app)
      .post(`/api/protected/${pay2!.id}/refund`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(blocked.status).toBe(409);

    // Limpieza: resolver el payout pendiente para no dejar saldo en IN_TRANSFER.
    const [payout2] = await db
      .select()
      .from(payouts)
      .where(eq(payouts.storeId, storeId))
      .orderBy(({ createdAt }) => ({ createdAt: "desc" }))
      .limit(1);
    if (payout2 && payout2.status === "PREPARED") {
      await request(app)
        .post(`/api/payouts/${payout2.id}/mark-paid`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ providerPayoutId: "cleanup-refund" });
    }
  });

  it("payouts exige autenticación y propiedad de la tienda", async () => {
    const anon = await request(app).get("/api/payouts/balance");
    expect(anon.status).toBe(401);

    const otherEmail = `other-${ts}@example.com`;
    const otherToken = await register(otherEmail);
    const other = await request(app)
      .get("/api/payouts/bank-accounts")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(other.status).toBe(404);
    await db.delete(users).where(eq(users.email, otherEmail));
  });

  it("desembolso automático: sin flag habilitado devuelve 501 y no toca el saldo", async () => {
    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);
    await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const requested = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(requested.status).toBe(201);
    const payoutId = requested.body.id as string;

    // Sin flag: 501, sin tocar el dinero.
    const auto = await request(app)
      .post(`/api/payouts/${payoutId}/auto`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(auto.status).toBe(501);

    // Limpieza: marcar como pagado para no dejar saldo en IN_TRANSFER.
    await request(app)
      .post(`/api/payouts/${payoutId}/mark-paid`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ providerPayoutId: "cleanup-test" });

    const [payoutRow] = await db
      .select({ status: payouts.status })
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .limit(1);
    expect(payoutRow!.status).toBe("SUCCESS");
  });

  it("desembolso automático: Wompi acepta y el payout pasa a SUCCESS", async () => {
    process.env.WOMPI_PAGOS_A_TERCEROS_ENABLED = "true";
    process.env.WOMPI_PAGOS_A_TERCEROS_USER_PRINCIPAL_ID = "test-principal";
    process.env.WOMPI_PAGOS_A_TERCEROS_API_KEY = "test-api-key";

    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);
    await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const requested = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(requested.status).toBe(201);
    const payoutId = requested.body.id as string;

    // Cuenta bancaria para el desembolso.
    await request(app)
      .post("/api/payouts/bank-accounts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        bankCode: "1",
        bankName: "Banco Uno",
        accountType: "AHORROS",
        accountNumber: "123456789012",
        holderName: "Dueña Test",
        holderDocType: "CC",
        holderDoc: "987654321",
        isDefault: true,
      });

    const auto = await request(app)
      .post(`/api/payouts/${payoutId}/auto`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(auto.status).toBe(200);
    expect(auto.body.status).toBe("SUCCESS");

    const balance = await balanceForStore(storeId);
    expect(balance.paidOut).toBeGreaterThan(0);
  });

  it("desembolso automático: Wompi rechaza y el payout pasa a FAILED con saldo en AVAILABLE", async () => {
    process.env.WOMPI_PAGOS_A_TERCEROS_ENABLED = "true";
    process.env.WOMPI_PAGOS_A_TERCEROS_USER_PRINCIPAL_ID = "test-principal";
    process.env.WOMPI_PAGOS_A_TERCEROS_API_KEY = "test-api-key";

    const orderId = await makeOrder();
    const checkout = await pseCheckout(orderId);
    const txId = checkout.body.transactionId as string;
    await approve(orderId, txId);
    const [pay] = await db
      .select()
      .from(protectedPayments)
      .where(eq(protectedPayments.orderId, orderId))
      .limit(1);
    await request(app)
      .post(`/api/protected/${pay!.id}/release`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const requested = await request(app)
      .post("/api/payouts/request")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(requested.status).toBe(201);
    const payoutId = requested.body.id as string;

    // Cuenta bancaria para el desembolso.
    await request(app)
      .post("/api/payouts/bank-accounts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        bankCode: "1",
        bankName: "Banco Uno",
        accountType: "AHORROS",
        accountNumber: "123456789012",
        holderName: "Dueña Test",
        holderDocType: "CC",
        holderDoc: "987654321",
        isDefault: true,
      });

    // Sobrescribe fetch para que Wompi rechace el desembolso.
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("payouts.wompi.co/v1/payouts") && (init as any)?.method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "cuenta invalida" }),
          text: async () => '{"error":"cuenta invalida"}',
        } as unknown as Response;
      }
      return originalFetch(url, init);
    };

    const auto = await request(app)
      .post(`/api/payouts/${payoutId}/auto`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(auto.status).toBe(402);
    expect(auto.body.error).toContain("cuenta invalida");

    // Restaura fetch.
    (globalThis as any).fetch = originalFetch;

    // El saldo debe haber vuelto a AVAILABLE.
    const balance = await balanceForStore(storeId);
    expect(balance.available).toBeGreaterThan(0);
  });
});
