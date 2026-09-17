import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores } from "../src/db/schema";
import { awardReferralPrestige } from "../src/lib/prestige";
import { activatePaidPlan } from "../src/lib/plans";
import "dotenv/config";

let app: Express;
const ts = Date.now();

async function registerUser(email: string, refCode?: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "User",
    termsAccepted: true,
    ...(refCode ? { refCode } : {}),
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

async function createStore(token: string, name: string) {
  const r = await request(app)
    .post("/api/stores")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, description: "Test", businessType: "OTRO" });
  return r;
}

async function storeByOwnerEmail(email: string) {
  return db
    .select({
      id: stores.id,
      plan: stores.plan,
      prestigePoints: stores.prestigePoints,
      referralCode: stores.referralCode,
      referredByStoreId: stores.referredByStoreId,
      referralRewarded: stores.referralRewarded,
      subscriptionExpiresAt: stores.subscriptionExpiresAt,
      prestigeGoal: stores.prestigeGoal,
    })
    .from(stores)
    .innerJoin(users, eq(stores.ownerId, users.id))
    .where(eq(users.email, email))
    .limit(1)
    .then((r) => r[0]);
}

describe("Prestigio por referidos", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  afterAll(async () => {
    // Borrar primero el referido B (apunta a A) y luego el referidor A.
    await db.delete(stores).where(eq(stores.name, `Ref B ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref A ${ts}`));
    await db.delete(users).where(eq(users.email, `ref-a-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-b-${ts}@example.com`));
  });

  it("un referido FREE NO suma prestigio; solo suma al activar su plan, una sola vez", async () => {
    // Referidor A: paga plan PRO (tiene código de referido). Su META sube +100.
    const tokenA = await registerUser(`ref-a-${ts}@example.com`);
    const storeA = await createStore(tokenA, `Ref A ${ts}`);
    expect(storeA.status).toBe(201);
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const a = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    expect(a.referralCode).toBeTruthy();
    expect(Number(a.prestigeGoal)).toBe(200); // base 100 + 100 al activar su plan
    // Renovar no toca los puntos, solo sube la meta de nuevo (+100 → 300).
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const aRenewed = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    expect(Number(aRenewed.prestigeGoal)).toBe(300);

    // Referido B: se registra con el código de A y crea su tienda FREE.
    const tokenB = await registerUser(`ref-b-${ts}@example.com`, a.referralCode!);
    const storeB = await createStore(tokenB, `Ref B ${ts}`);
    expect(storeB.status).toBe(201);

    const aAfterB = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    const b = await storeByOwnerEmail(`ref-b-${ts}@example.com`);

    // Se guardó la referencia, pero NO se premió (la tienda del referido es FREE).
    expect(b.referredByStoreId).toBe(storeA.body.id);
    expect(aAfterB.prestigePoints).toBe("0");
    expect(b.referralRewarded).toBe(false);

    // B activa su plan → el referidor A gana el premio (+25 y +3 días de plan).
    const expiryBefore = new Date(aAfterB.subscriptionExpiresAt!).getTime();
    await activatePaidPlan(b.id, "PRO", "MONTHLY");
    const awarded = await awardReferralPrestige(b.id);
    expect(awarded).toBe(25);

    const aAfterPay = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    const bAfterPay = await storeByOwnerEmail(`ref-b-${ts}@example.com`);
    expect(Number(aAfterPay.prestigePoints)).toBe(25);
    expect(bAfterPay.referralRewarded).toBe(true);
    const bonusMs = new Date(aAfterPay.subscriptionExpiresAt!).getTime() - expiryBefore;
    expect(bonusMs).toBeGreaterThanOrEqual(2 * 24 * 60 * 60 * 1000);
    expect(bonusMs).toBeLessThan(4 * 24 * 60 * 60 * 1000);

    // Idempotente: renovar/reactivar el plan no vuelve a premiar.
    const again = await awardReferralPrestige(b.id);
    expect(again).toBe(0);
    const aAfterAgain = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    expect(Number(aAfterAgain.prestigePoints)).toBe(25);
  });

  it("un referidor FREE no obtiene prestigio por el pago de su referido", async () => {
    const token = await registerUser(`ref-free-${ts}@example.com`);
    const store = await createStore(token, `Ref Free ${ts}`);
    expect(store.status).toBe(201);

    // El referidor es FREE pero igual tiene código: darle uno manualmente.
    const [freeUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, `ref-free-${ts}@example.com`))
      .limit(1);
    await db
      .update(stores)
      .set({ referralCode: `FR${ts}CODE` })
      .where(eq(stores.ownerId, freeUser!.id));

    const tokenB = await registerUser(`ref-free-b-${ts}@example.com`, `FR${ts}CODE`);
    const storeB = await createStore(tokenB, `Ref Free B ${ts}`);
    const b = await storeByOwnerEmail(`ref-free-b-${ts}@example.com`);
    // Como el referidor es FREE, la referencia ni se guarda: no habrá premio jamás.
    expect(b.referredByStoreId).toBeNull();
    expect(storeB.status).toBe(201);
  });
});