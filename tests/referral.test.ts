import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, sales } from "../src/db/schema";
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
    await db.delete(stores).where(eq(stores.name, `Ref Pending B ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Pending A ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Free ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Free B ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Acc A ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Acc B ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Acc C ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Acc R ${ts}`));
    await db.delete(stores).where(eq(stores.name, `Ref Cap ${ts}`));
    const checkStore = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.name, `Ref Check ${ts}`));
    if (checkStore.length) {
      await db.delete(sales).where(eq(sales.storeId, checkStore[0].id));
    }
    await db.delete(stores).where(eq(stores.name, `Ref Check ${ts}`));
    await db.delete(users).where(eq(users.email, `ref-a-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-b-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-pend-a-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-pend-b-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-free-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-free-b-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-acc-r-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-acc-a-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-acc-b-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-acc-c-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-cap-${ts}@example.com`));
    await db.delete(users).where(eq(users.email, `ref-check-${ts}@example.com`));
  });

  it("un referido FREE NO suma prestigio; solo suma al activar su plan, una sola vez", async () => {
    // Referidor A: paga plan PRO (tiene código de referido). Su META sube +100.
    const tokenA = await registerUser(`ref-a-${ts}@example.com`);
    const storeA = await createStore(tokenA, `Ref A ${ts}`);
    expect(storeA.status).toBe(201);
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const a = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    expect(a.referralCode).toBeTruthy();
    expect(Number(a.prestigeGoal)).toBe(100); // una tienda nueva arranca en la base 100
    // Renovar no toca los puntos, sube la meta +100 → 200.
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const aRenewed = await storeByOwnerEmail(`ref-a-${ts}@example.com`);
    expect(Number(aRenewed.prestigeGoal)).toBe(200);

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

  it("el premio no se pierde si el referidor está en TRIAL cuando el referido paga", async () => {
    // Referidor A paga su plan y genera código.
    const tokenA = await registerUser(`ref-pend-a-${ts}@example.com`);
    const storeA = await createStore(tokenA, `Ref Pending A ${ts}`);
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const a = await storeByOwnerEmail(`ref-pend-a-${ts}@example.com`);
    expect(a.referralCode).toBeTruthy();

    // El referido B se registra con el código de A y crea tienda.
    const tokenB = await registerUser(`ref-pend-b-${ts}@example.com`, a.referralCode!);
    const storeB = await createStore(tokenB, `Ref Pending B ${ts}`);
    const b = await storeByOwnerEmail(`ref-pend-b-${ts}@example.com`);
    expect(b.referredByStoreId).toBe(storeA.body.id);

    // B paga su plan. Si en ese momento A pierde su plan (pasa a trial/manual),
    // el premio NO se otorga pero NO se quema la bandera: queda pendiente.
    await db
      .update(stores)
      .set({ plan: "PRO", subscriptionCycle: null }) // trial/manual
      .where(eq(stores.id, storeA.body.id));
    await activatePaidPlan(b.id, "PRO", "MONTHLY");
    const pendiente = await awardReferralPrestige(b.id);
    expect(pendiente).toBe(0);
    const bStillPending = await storeByOwnerEmail(`ref-pend-b-${ts}@example.com`);
    expect(bStillPending.referralRewarded).toBe(false);

    // A reactiva su plan → el premio pendiente SÍ se otorga (no se perdió).
    await activatePaidPlan(storeA.body.id, "PRO", "MONTHLY");
    const awarded = await awardReferralPrestige(b.id);
    expect(awarded).toBe(25);

    const aAfter = await storeByOwnerEmail(`ref-pend-a-${ts}@example.com`);
    const bAfter = await storeByOwnerEmail(`ref-pend-b-${ts}@example.com`);
    expect(Number(aAfter.prestigePoints)).toBe(25);
    expect(bAfter.referralRewarded).toBe(true);

    // Sigue idempotente.
    const again = await awardReferralPrestige(b.id);
    expect(again).toBe(0);
  });

  it("acumula +25 por CADA referido que paga su plan (3 pagos → 75)", async () => {
    const tokenR = await registerUser(`ref-acc-r-${ts}@example.com`);
    const storeR = await createStore(tokenR, `Ref Acc R ${ts}`);
    await activatePaidPlan(storeR.body.id, "PRO", "MONTHLY");
    const r = await storeByOwnerEmail(`ref-acc-r-${ts}@example.com`);
    expect(r.referralCode).toBeTruthy();

    const referidos = [
      { tag: "a", email: `ref-acc-a-${ts}@example.com`, name: `Ref Acc A ${ts}` },
      { tag: "b", email: `ref-acc-b-${ts}@example.com`, name: `Ref Acc B ${ts}` },
      { tag: "c", email: `ref-acc-c-${ts}@example.com`, name: `Ref Acc C ${ts}` },
    ];

    for (let i = 0; i < referidos.length; i++) {
      const { email, name } = referidos[i];
      const token = await registerUser(email, r.referralCode!);
      const store = await createStore(token, name);
      expect(store.status).toBe(201);
      const ref = await storeByOwnerEmail(email);
      expect(ref.referredByStoreId).toBe(storeR.body.id);

      await activatePaidPlan(ref.id, "PRO", "MONTHLY");
      const awarded = await awardReferralPrestige(ref.id);
      expect(awarded).toBe(25);

      const rNow = await storeByOwnerEmail(`ref-acc-r-${ts}@example.com`);
      expect(Number(rNow.prestigePoints)).toBe(25 * (i + 1));
    }

    // Renovar el plan de un referido no vuelve a sumar (idempotente por referido).
    const refA = await storeByOwnerEmail(`ref-acc-a-${ts}@example.com`);
    await activatePaidPlan(refA.id, "PRO", "MONTHLY");
    const again = await awardReferralPrestige(refA.id);
    expect(again).toBe(0);
    const rFinal = await storeByOwnerEmail(`ref-acc-r-${ts}@example.com`);
    expect(Number(rFinal.prestigePoints)).toBe(75);
  });

  it("la meta sube +100 al hacer UPGRADE y respeta el tope de 1000", async () => {
    const token = await registerUser(`ref-cap-${ts}@example.com`);
    const store = await createStore(token, `Ref Cap ${ts}`);
    const id = store.body.id;

    // Activación inicial: meta base 100 (una tienda nueva no arranca en 200).
    await activatePaidPlan(id, "PRO", "MONTHLY");
    let s = await storeByOwnerEmail(`ref-cap-${ts}@example.com`);
    expect(Number(s.prestigeGoal)).toBe(100);

    // UPGRADE de plan (mejora): +100 → 200.
    await activatePaidPlan(id, "BUSINESS", "MONTHLY");
    s = await storeByOwnerEmail(`ref-cap-${ts}@example.com`);
    expect(s.plan).toBe("BUSINESS");
    expect(Number(s.prestigeGoal)).toBe(200);

    // Renovaciones/mejoras sucesivas: siguen subiendo +100 hasta el tope 1000.
    for (let i = 0; i < 20; i++) {
      await activatePaidPlan(id, "BUSINESS", "MONTHLY");
    }
    s = await storeByOwnerEmail(`ref-cap-${ts}@example.com`);
    expect(Number(s.prestigeGoal)).toBe(1000); // nunca pasa de 1000
  });

  it("concede el check cuando puntos>=meta, 7+ días y 1 venta rastreable (y es sticky)", async () => {
    const token = await registerUser(`ref-check-${ts}@example.com`);
    const store = await createStore(token, `Ref Check ${ts}`);
    const id = store.body.id;
    await activatePaidPlan(id, "PRO", "MONTHLY"); // meta 200

    // Puntos suficientes para la meta, pero tienda recién creada y sin ventas.
    await db.update(stores).set({ prestigePoints: "200" }).where(eq(stores.id, id));
    let res = await request(app)
      .get("/api/stores/referral")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.criteria.minAgeDays).toBe(7);
    expect(res.body.criteria.minSales).toBe(1);
    expect(res.body.criteria.trackedSales).toBe(0);
    expect(res.body.criteria.storeAgeDays).toBeLessThan(7);

    // Antigüedad de 8 días + una venta rastreable → se concede el check.
    await db
      .update(stores)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(stores.id, id));
    await db
      .insert(sales)
      .values({ storeId: id, total: "50000", paymentMethod: "MP", origin: "manual" });

    res = await request(app)
      .get("/api/stores/referral")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.verified).toBe(true);

    // Sticky: aunque luego baje los puntos, sigue verificado.
    await db.update(stores).set({ prestigePoints: "0" }).where(eq(stores.id, id));
    res = await request(app)
      .get("/api/stores/referral")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.verified).toBe(true);
  });
});