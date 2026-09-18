import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, mpPayments } from "../src/db/schema";
import { priceFor } from "../src/lib/plans";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const email = `renewal-${ts}@example.com`;
let storeId = "";
// id de pago → plan/ciclo que simula el pago aprobado de Mercado Pago.
const payments = new Map<string, { plan: "PRO" | "BUSINESS"; cycle: "MONTHLY" | "BI_MONTHLY" }>();

async function getStore() {
  const [s] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  return s;
}

async function waitForGoal(expected: number, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getStore();
    if (Number(s?.prestigeGoal) === expected) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return getStore();
}

async function payAndWait(id: string, plan: "PRO" | "BUSINESS", cycle: "MONTHLY" | "BI_MONTHLY", expectedGoal: number) {
  payments.set(id, { plan, cycle });
  const r = await request(app)
    .post("/api/payments/mercadopago/webhook")
    .send({ type: "payment", data: { id } });
  expect(r.status).toBe(200);
  return waitForGoal(expectedGoal);
}

describe("Renovación / upgrade end-to-end vía webhook de pago", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    // Mock de la API de Mercado Pago: devuelve un pago aprobado cuyo
    // external_reference apunta a la tienda real y al plan/ciclo simulados.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String(url);
      const m = u.match(/\/v1\/payments\/([^/?]+)/);
      const id = m ? decodeURIComponent(m[1]) : "unknown";
      const meta = payments.get(id);
      const body = {
        id,
        status: "approved",
        status_detail: null,
        transaction_amount: meta ? priceFor(meta.plan, meta.cycle) : null,
        external_reference: meta ? `${storeId}_${meta.plan}_${meta.cycle}` : null,
        metadata: null,
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    });

    // Usuario + tienda reales (FREE).
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Renew User",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
    const token = login.body.token as string;
    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Renewal ${ts}`, description: "Test", businessType: "ROPA" });
    storeId = store.body.id;
    expect(storeId).toBeTruthy();
    expect(store.body.plan).toBe("FREE");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (storeId) {
      await db.delete(mpPayments).where(eq(mpPayments.storeId, storeId));
      await db.delete(stores).where(eq(stores.id, storeId));
    }
    await db.delete(users).where(eq(users.email, email));
  });

  it("activación inicial → meta 100; renovación → 200; upgrade → 300", async () => {
    // Primera activación: base 100 (no 200).
    let s = await payAndWait(`P-${ts}-1`, "PRO", "MONTHLY", 100);
    expect(s!.plan).toBe("PRO");
    expect(Number(s!.prestigeGoal)).toBe(100);

    // Renovación del mismo plan: +100 → 200.
    s = await payAndWait(`P-${ts}-2`, "PRO", "MONTHLY", 200);
    expect(s!.plan).toBe("PRO");
    expect(Number(s!.prestigeGoal)).toBe(200);

    // Upgrade a BUSINESS: +100 → 300.
    s = await payAndWait(`P-${ts}-3`, "BUSINESS", "MONTHLY", 300);
    expect(s!.plan).toBe("BUSINESS");
    expect(Number(s!.prestigeGoal)).toBe(300);
    expect(s!.subscriptionExpiresAt).toBeTruthy();
  });

  it("un pago repetido (mismo id) NO vuelve a subir la meta", async () => {
    const before = Number((await getStore())!.prestigeGoal);
    // Reenviamos el último pago: debe ser idempotente.
    await request(app)
      .post("/api/payments/mercadopago/webhook")
      .send({ type: "payment", data: { id: `P-${ts}-3` } });
    await new Promise((r) => setTimeout(r, 800));
    const after = Number((await getStore())!.prestigeGoal);
    expect(after).toBe(before);
  });
});
