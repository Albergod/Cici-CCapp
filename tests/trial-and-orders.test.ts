import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, orders, orderItems, sales, saleItems } from "../src/db/schema";
import { expireStoresAndReturnCount } from "../src/routes/store.routes";
import { awardReferralPrestige } from "../src/lib/prestige";
import { createPendingOrder } from "../src/lib/orders";
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

async function loginUser(email: string) {
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

async function createStore(token: string, name: string, businessType = "OTRO") {
  return request(app)
    .post("/api/stores")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, description: "Test", businessType });
}

async function storeIdByOwnerEmail(email: string): Promise<string> {
  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .innerJoin(users, eq(stores.ownerId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  return store!.id;
}

describe("Prueba gratis universal de 14 días", () => {
  const emails = {
    a: `trial-a-${ts}@example.com`,
    b: `trial-b-${ts}@example.com`,
    c: `trial-c-${ts}@example.com`,
  };

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  afterAll(async () => {
    const clean = async (email: string) => {
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .innerJoin(users, eq(stores.ownerId, users.id))
        .where(eq(users.email, email))
        .limit(1);
      if (store) await db.delete(stores).where(eq(stores.id, store.id));
      await db.delete(users).where(eq(users.email, email));
    };
    await clean(emails.a);
    await clean(emails.b);
    await clean(emails.c);
  });

  it("toda tienda nueva abre en prueba: plan PRO, sin ciclo y ~14 días", async () => {
    const token = await registerUser(emails.a);
    const r = await createStore(token, `Trial A ${ts}`);
    expect(r.status).toBe(201);
    expect(r.body.plan).toBe("PRO");
    expect(r.body.subscriptionCycle).toBeNull();
    expect(r.body.onTrial).toBe(true);
    expect(r.body.referralCode).toBeNull();

    // Fecha de fin de prueba ≈ now + 14 días (±2h de holgura).
    const plus14 = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs((r.body.trialEndsAt as number) - plus14)).toBeLessThan(2 * 60 * 60 * 1000);

    // El perfil público reporta status trial (no active) durante la prueba.
    const profile = await request(app).get(`/api/stores/${r.body.slug}`);
    expect(profile.status).toBe(200);
    expect(profile.body.subscriptionStatus).toBe("trial");
  });

  it("durante la prueba los referidos están bloqueados (active:false)", async () => {
    const token = await registerUser(emails.b);
    const r = await createStore(token, `Trial B ${ts}`);
    expect(r.status).toBe(201);

    const ref = await request(app)
      .get("/api/stores/referral")
      .set("Authorization", `Bearer ${token}`);
    expect(ref.status).toBe(200);
    expect(ref.body.active).toBe(false);
    expect(ref.body.message).toMatch(/14 días/i);
    // El enlace no se genera porque aún no hay código.
    expect(ref.body.referralCode).toBeUndefined();
  });

  it("un referidor en prueba no premia a su referido (awardReferralPrestige → 0)", async () => {
    const token = await registerUser(emails.c);
    const r = await createStore(token, `Trial C ${ts}`);
    expect(r.status).toBe(201);
    const trialId = r.body.id as string;

    // Simulamos una referencia ya establecida hacia la tienda en prueba.
    const tokenX = await registerUser(`trial-x-${ts}@example.com`);
    const rx = await createStore(tokenX, `Trial X ${ts}`);
    await db
      .update(stores)
      .set({ referredByStoreId: trialId })
      .where(eq(stores.id, rx.body.id));

    const awarded = await awardReferralPrestige(rx.body.id as string);
    expect(awarded).toBe(0);

    const [referrer] = await db
      .select({ prestigePoints: stores.prestigePoints, subscriptionExpiresAt: stores.subscriptionExpiresAt })
      .from(stores)
      .where(eq(stores.id, trialId))
      .limit(1);
    expect(Number(referrer.prestigePoints)).toBe(0);
    // No se extendió la suscripción con días de regalo.
    expect(referrer.subscriptionExpiresAt).not.toBeNull();

    // Usuario auxiliar: limpiar su tienda (sin referidos que apunten fuera).
    const aid = await storeIdByOwnerEmail(`trial-x-${ts}@example.com`);
    await db.delete(stores).where(eq(stores.id, aid));
    await db.delete(users).where(eq(users.email, `trial-x-${ts}@example.com`));
  });

  it("al vencer la prueba la tienda baja a FREE sin ciclo (modo manual)", async () => {
    const id = await storeIdByOwnerEmail(emails.a);
    await db
      .update(stores)
      .set({ subscriptionExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(stores.id, id));

    const expired = await expireStoresAndReturnCount();
    expect(expired).toBeGreaterThanOrEqual(1);

    const [after] = await db
      .select({ plan: stores.plan, cycle: stores.subscriptionCycle, expiresAt: stores.subscriptionExpiresAt })
      .from(stores)
      .where(eq(stores.id, id))
      .limit(1);
    expect(after.plan).toBe("FREE");
    expect(after.cycle).toBeNull();
    expect(after.expiresAt).toBeNull();

    // El enlace de referidos queda desactivado tras la prueba.
    const ref = await request(app)
      .get("/api/stores/referral")
      .set("Authorization", `Bearer ${await loginUser(emails.a)}`);
    expect(ref.status).toBe(200);
    expect(ref.body.active).toBe(false);
    expect(ref.body.referralCode).toBeUndefined();
  });
});

describe("Fase 2: pedidos del chat (venta automática)", () => {
  const owner = `ord-m-${ts}@example.com`;
  const intruder = `ord-i-${ts}@example.com`;
  const customer = `ord-c-${ts}@example.com`;
  const storeName = `Orders Store ${ts}`;
  const intruderStoreName = `Orders Intruder ${ts}`;
  let tokenM = "";
  let storeId = "";
  let productId = "";
  let pendingOrderId = "";
  let customerId = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    const tokenC = await registerUser(customer);
    const [cUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, customer))
      .limit(1);
    customerId = cUser!.id;

    tokenM = await registerUser(owner);
    const store = await createStore(tokenM, storeName);
    expect(store.status).toBe(201);
    storeId = store.body.id;

    const product = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Camisa Algodón", price: 45000, stock: 10 });
    expect(product.status).toBe(201);
    productId = product.body.id;
  });

  afterAll(async () => {
    for (const name of [storeName, intruderStoreName]) {
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.name, name))
        .limit(1);
      if (store) {
        const orderRows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.storeId, store.id));
        if (orderRows.length) {
          await db.delete(orderItems).where(inArray(orderItems.orderId, orderRows.map((o) => o.id)));
          await db.delete(orders).where(eq(orders.storeId, store.id));
        }
        const storeSales = await db
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.storeId, store.id));
        if (storeSales.length) {
          await db.delete(saleItems).where(inArray(saleItems.saleId, storeSales.map((s) => s.id)));
        }
        await db.delete(sales).where(eq(sales.storeId, store.id));
        await db.delete(products).where(eq(products.storeId, store.id));
        await db.delete(stores).where(eq(stores.id, store.id));
      }
    }
    await db.delete(users).where(inArray(users.email, [owner, intruder, customer]));
  });

  it("crea un pedido pendiente sin tocar stock (MVP: 1 producto)", async () => {
    const res = await createPendingOrder({
      storeId,
      customerId,
      productName: "Camisa Algodón",
      quantity: 2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    pendingOrderId = res.orderId;

    const [product] = await db
      .select({ stock: products.stock, available: products.available })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    // El pedido pendiente NO descuenta stock.
    expect(Number(product.stock)).toBe(10);

    const [row] = await db
      .select({ status: orders.status, saleId: orders.saleId })
      .from(orders)
      .where(eq(orders.id, pendingOrderId))
      .limit(1);
    expect(row.status).toBe("pending");
    expect(row.saleId).toBeNull();
  });

  it("rechaza producto inexistente o sin stock", async () => {
    const bad = await createPendingOrder({
      storeId,
      customerId,
      productName: "No Existe",
      quantity: 1,
    });
    expect(bad.ok).toBe(false);

    const oversold = await createPendingOrder({
      storeId,
      customerId,
      productName: "Camisa Algodón",
      quantity: 9999,
    });
    expect(oversold.ok).toBe(false);
  });

  it("el comerciante ve el pedido y lo confirma → venta origin=order y stock descontado", async () => {
    const list = await request(app).get("/api/orders").set("Authorization", `Bearer ${tokenM}`);
    expect(list.status).toBe(200);
    expect(list.body.some((o: { id: string }) => o.id === pendingOrderId)).toBe(true);

    const confirm = await request(app)
      .post(`/api/orders/${pendingOrderId}/confirm`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("sold");
    expect(confirm.body.saleId).toBeTruthy();

    const [product] = await db
      .select({ stock: products.stock, available: products.available })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    expect(Number(product.stock)).toBe(8); // 10 - 2

    const [sale] = await db
      .select({ origin: sales.origin, total: sales.total })
      .from(sales)
      .where(eq(sales.id, confirm.body.saleId))
      .limit(1);
    expect(sale.origin).toBe("order");
    expect(Number(sale.total)).toBe(90000);
  });

  it("un pedido no se puede confirmar dos veces", async () => {
    const again = await request(app)
      .post(`/api/orders/${pendingOrderId}/confirm`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(again.status).toBe(409);
  });

  it("otro usuario no puede confirmar pedidos ajenos", async () => {
    const tokenI = await registerUser(intruder);
    await createStore(tokenI, intruderStoreName);
    const list = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${tokenI}`);
    // No pertenece a ninguna tienda con pedidos.
    expect(list.body.length).toBe(0);

    const confirm = await request(app)
      .post(`/api/orders/${pendingOrderId}/confirm`)
      .set("Authorization", `Bearer ${tokenI}`);
    expect(confirm.status).toBe(404);
  });

  it("cancela un pedido pendiente (con su venta ya hecha solo en pending)", async () => {
    // Crear otro pedido para cancelarlo.
    const second = await createPendingOrder({
      storeId,
      customerId,
      productName: "Camisa Algodón",
      quantity: 1,
    });
    if (!second.ok) throw new Error("no se pudo crear pedido");
    const cancel = await request(app)
      .post(`/api/orders/${second.orderId}/cancel`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    const cancelAgain = await request(app)
      .post(`/api/orders/${second.orderId}/cancel`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(cancelAgain.status).toBe(409);
  });
});