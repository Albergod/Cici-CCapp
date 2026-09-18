import "./wompi-env";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, mpPayments } from "../src/db/schema";
import { priceFor } from "../src/lib/plans";
import { verifyWompiWebhook, WOMPI_ENV } from "../src/lib/wompi";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `wompi-${ts}@example.com`;
let storeId = "";
let counter = 0;

type Tx = {
  id: string;
  status: string;
  reference: string | null;
  amount_in_cents: number | null;
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

async function getStore() {
  const [s] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  return s;
}

async function waitForGoal(expected: number, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getStore();
    if (Number(s?.prestigeGoal) === expected) return s;
    await new Promise((r) => setTimeout(r, 80));
  }
  return getStore();
}

// Crea un cobro Nequi por la API y devuelve su transactionId.
async function createNequi(token: string, plan: "PRO" | "BUSINESS") {
  const r = await request(app)
    .post("/api/payments/wompi/nequi")
    .set("Authorization", `Bearer ${token}`)
    .send({ storeId, plan, cycle: "MONTHLY", phoneNumber: "3101234567" });
  expect(r.status).toBe(200);
  return r.body.transactionId as string;
}

describe("Pagos Wompi/Nequi (API mockeada)", () => {
  let token = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";

      // Tokens de aceptación (Habeas Data).
      if (u.includes("/merchants/")) {
        return jsonResponse({
          data: {
            presigned_acceptance: { acceptance_token: "acc-token" },
            presigned_personal_data_auth: { acceptance_token: "pda-token" },
          },
        });
      }

      // Consultar una transacción.
      const match = u.match(/\/transactions\/([^/?]+)$/);
      if (match && method === "GET") {
        const tx = txs.get(decodeURIComponent(match[1]));
        return jsonResponse({ data: tx ?? null });
      }

      // Crear transacción.
      if (u.endsWith("/transactions") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          amount_in_cents: number;
          reference: string;
        };
        const id = `tx-${ts}-${++counter}`;
        txs.set(id, {
          id,
          status: "PENDING",
          reference: body.reference,
          amount_in_cents: body.amount_in_cents,
        });
        return jsonResponse({ data: { id, status: "PENDING" } });
      }

      return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" } as unknown as Response;
    });

    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Wompi User",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
    token = login.body.token as string;
    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Wompi ${ts}`, description: "Test", businessType: "OTRO" });
    storeId = store.body.id;
    expect(storeId).toBeTruthy();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (storeId) {
      await db.delete(mpPayments).where(eq(mpPayments.storeId, storeId));
      await db.delete(stores).where(eq(stores.id, storeId));
    }
    await db.delete(users).where(eq(users.email, email));
  });

  it("el entorno se resuelve como sandbox con llaves _test_", () => {
    expect(WOMPI_ENV).toBe("sandbox");
    // sanity: la verificación de firma está cargada.
    expect(verifyWompiWebhook({ signature: { properties: [], timestamp: 1 } }, "x")).toBe(false);
  });

  it("crea el cobro, el status APPROVED activa el plan (meta 100) y la renovación suma +100", async () => {
    const id1 = await createNequi(token, "PRO");
    expect(id1).toBeTruthy();

    // La transacción arranca PENDING; sin aprobar no se activa nada.
    let s = await getStore();
    expect(s!.plan).toBe("FREE");

    // Wompi confirma el pago (mock).
    txs.get(id1)!.status = "APPROVED";
    const st = await request(app)
      .get(`/api/payments/wompi/status?transactionId=${encodeURIComponent(id1)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(st.status).toBe(200);
    expect(st.body.approved).toBe(true);
    s = await waitForGoal(100);
    expect(s!.plan).toBe("PRO");
    expect(Number(s!.prestigeGoal)).toBe(100);

    // Renovación: nuevo cobro aprobado → +100 → 200.
    const id2 = await createNequi(token, "PRO");
    txs.get(id2)!.status = "APPROVED";
    await request(app)
      .get(`/api/payments/wompi/status?transactionId=${encodeURIComponent(id2)}`)
      .set("Authorization", `Bearer ${token}`);
    s = await waitForGoal(200);
    expect(Number(s!.prestigeGoal)).toBe(200);
  });

  it("rechaza un pago con monto distinto (amount_mismatch)", async () => {
    const before = Number((await getStore())!.prestigeGoal);
    const id = await createNequi(token, "PRO");
    txs.get(id)!.status = "APPROVED";
    txs.get(id)!.amount_in_cents = 1; // monto incorrecto

    const st = await request(app)
      .get(`/api/payments/wompi/status?transactionId=${encodeURIComponent(id)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(st.body.approved).toBe(false);
    expect(st.body.detail).toBe("amount_mismatch");

    await new Promise((r) => setTimeout(r, 300));
    expect(Number((await getStore())!.prestigeGoal)).toBe(before);
  });

  it("webhook con firma válida activa el plan; con firma inválida no", async () => {
    // Cobro pendiente aprobado en Wompi.
    const id = await createNequi(token, "PRO");
    txs.get(id)!.status = "APPROVED";
    const amount = priceFor("PRO", "MONTHLY") * 100;
    const timestamp = Math.floor(Date.now() / 1000);

    const payload = {
      event: "transaction.updated",
      data: {
        transaction: { id, status: "APPROVED", amount_in_cents: amount },
      },
      signature: {
        properties: [
          "transaction.id",
          "transaction.status",
          "transaction.amount_in_cents",
        ],
        timestamp,
        checksum: "",
      },
    };
    // Firma correcta: sha256(propiedades en orden + timestamp + events_key).
    const raw = `${id}APPROVED${amount}${timestamp}${process.env.WOMPI_EVENTS_KEY}`;
    const checksum = crypto.createHash("sha256").update(raw, "utf8").digest("hex").toUpperCase();

    // Firma inválida primero: no debe activar.
    const before = Number((await getStore())!.prestigeGoal);
    await request(app)
      .post("/api/payments/wompi/webhook")
      .set("X-Event-Checksum", "DEADBEEF")
      .send(payload);
    await new Promise((r) => setTimeout(r, 400));
    expect(Number((await getStore())!.prestigeGoal)).toBe(before);

    // Firma válida: activa → +100.
    await request(app)
      .post("/api/payments/wompi/webhook")
      .set("X-Event-Checksum", checksum)
      .send(payload);
    const after = await waitForGoal(before + 100);
    expect(Number(after!.prestigeGoal)).toBe(before + 100);
  });
});
