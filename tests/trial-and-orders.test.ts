import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products, orders, orderItems, sales, saleItems } from "../src/db/schema";
import { expireStoresAndReturnCount } from "../src/routes/store.routes";
import { awardReferralPrestige } from "../src/lib/prestige";
import { createPendingOrder } from "../src/lib/orders";
import { parseOrderCommand } from "../src/lib/ai";
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

async function addProduct(token: string, storeId: string, name = "Camisa Algodón") {
  return request(app)
    .post(`/api/stores/${storeId}/products`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name, price: 45000, stock: 10 });
}

async function activateTrial(token: string, storeId: string) {
  return request(app)
    .post(`/api/stores/${storeId}/trial`)
    .set("Authorization", `Bearer ${token}`);
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
      if (store) {
        const prods = await db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.storeId, store.id));
        if (prods.length) {
          await db.delete(products).where(inArray(products.id, prods.map((p) => p.id)));
        }
        await db.delete(stores).where(eq(stores.id, store.id));
      }
      await db.delete(users).where(eq(users.email, email));
    };
    await clean(emails.a);
    await clean(emails.b);
    await clean(emails.c);
  });

  it("activa la prueba solo con contenido (≥1 producto) y abre PRO ~14 días", async () => {
    const token = await registerUser(emails.a);
    const r = await createStore(token, `Trial A ${ts}`);
    expect(r.status).toBe(201);
    // Nace FREE: la prueba no arranca sola.
    expect(r.body.plan).toBe("FREE");
    expect(r.body.onTrial).toBe(false);
    expect(r.body.referralCode).toBeNull();

    // Sin contenido la activación se rechaza.
    const denied = await activateTrial(token, r.body.id);
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe("business_not_activated");

    await addProduct(token, r.body.id);
    const t = await activateTrial(token, r.body.id);
    expect(t.status).toBe(201);
    expect(t.body.plan).toBe("PRO");
    expect(t.body.subscriptionCycle).toBeNull();
    expect(t.body.onTrial).toBe(true);
    expect(t.body.referralCode).toBeNull();

    // Fecha de fin de prueba ≈ now + 14 días (±2h de holgura).
    const plus14 = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs((t.body.trialEndsAt as number) - plus14)).toBeLessThan(2 * 60 * 60 * 1000);

    // El perfil público reporta status trial (no active) durante la prueba.
    const profile = await request(app).get(`/api/stores/${r.body.slug}`);
    expect(profile.status).toBe(200);
    expect(profile.body.subscriptionStatus).toBe("trial");

    // Una sola vez por propietario (trialUsedAt).
    const again = await activateTrial(token, r.body.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/ya usaste/i);
  });

  it("durante la prueba los referidos están bloqueados (active:false)", async () => {
    const token = await registerUser(emails.b);
    const r = await createStore(token, `Trial B ${ts}`);
    await addProduct(token, r.body.id);
    const t = await activateTrial(token, r.body.id);
    expect(t.status).toBe(201);

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
    await addProduct(token, r.body.id);
    const t = await activateTrial(token, r.body.id);
    expect(t.status).toBe(201);
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
  let product2Id = "";

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

    const product2 = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Pantalón", price: 38000, stock: 6 });
    expect(product2.status).toBe(201);
    product2Id = product2.body.id;
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

  it("GET /api/stores/mine encuentra la tienda del dueño (no el feed paginado)", async () => {
    const mine = await request(app)
      .get("/api/stores/mine")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).toBe(storeId);
    expect(mine.body.slug).toBeTruthy();

    // Un usuario sin tienda recibe 404 (el dashboard muestra el alta).
    const tokenC = await loginUser(customer);
    const none = await request(app)
      .get("/api/stores/mine")
      .set("Authorization", `Bearer ${tokenC}`);
    expect(none.status).toBe(404);
  });

  it("publicar con stock 0 deja el producto desactivado; con stock>0 activo", async () => {
    const zero = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Sin stock", price: 10000, stock: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.available).toBe(false);

    const some = await request(app)
      .post(`/api/stores/${storeId}/products`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Con stock", price: 10000, stock: 3 });
    expect(some.status).toBe(201);
    expect(some.body.available).toBe(true);
  });

  it("parsea canastas multi-producto emitidas por la IA", () => {
    const single = parseOrderCommand("PEDIDO|Camisa Algodón|2");
    expect(single).toEqual({ items: [{ productName: "Camisa Algodón", quantity: 2 }] });

    const multi = parseOrderCommand(
      'PEDIDO|[{"nombre":"Camisa Algodón","cantidad":2},{"nombre":"Pantalón","cantidad":3}]',
    );
    expect(multi).toEqual({
      items: [
        { productName: "Camisa Algodón", quantity: 2 },
        { productName: "Pantalón", quantity: 3 },
      ],
    });

    // Descarta ítems inválidos dentro del JSON; si no queda ninguno → null.
    const bad = parseOrderCommand('PEDIDO|[{"cantidad":5}]');
    expect(bad).toBeNull();
    // Un texto cualquiera no es una orden.
    expect(parseOrderCommand("hola")).toBeNull();
  });

  it("crea un pedido pendiente multi-producto: valida stock y no descuenta", async () => {
    const res = await createPendingOrder({
      storeId,
      customerId,
      items: [
        { productName: "Camisa Algodón", quantity: 1 },
        { productName: "Pantalón", quantity: 2 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items).toHaveLength(2);
    if (res.ok && res.items.length === 2) {
      expect(res.items[0].productName).toBe("Camisa Algodón");
      expect(res.items[0].lineTotal).toBe(45000);
      expect(res.items[1].productName).toBe("Pantalón");
      expect(res.items[1].lineTotal).toBe(76000);
    }
    expect(res.total).toBe(121000);

    // Ningún stock se tocó al anotar el pedido.
    const [p1] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const [p2] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, product2Id))
      .limit(1);
    expect(Number(p1.stock)).toBe(10);
    expect(Number(p2.stock)).toBe(6);
  });

  it("rechaza canasta con un producto sin stock suficiente", async () => {
    const oversold = await createPendingOrder({
      storeId,
      customerId,
      items: [
        { productName: "Camisa Algodón", quantity: 1 },
        { productName: "Pantalón", quantity: 500 },
      ],
    });
    expect(oversold.ok).toBe(false);
    if (!oversold.ok) expect(oversold.code).toBe("insufficient_stock");
  });

  it("mezcla cantidades de un mismo producto repetido en la canasta", async () => {
    const res = await createPendingOrder({
      storeId,
      customerId,
      items: [
        { productName: "Pantalón", quantity: 1 },
        { productName: "Pantalón", quantity: 2 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Líneas agregadas: un solo ítem por producto repetido.
    expect(res.items).toHaveLength(1);
    expect(res.items[0].quantity).toBe(3);
    expect(res.total).toBe(38000 * 3);
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

  it("confirma una canasta multi-producto → venta origin=order con ambos productos", async () => {
    const res = await createPendingOrder({
      storeId,
      customerId,
      items: [
        { productName: "Camisa Algodón", quantity: 1 },
        { productName: "Pantalón", quantity: 2 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const confirm = await request(app)
      .post(`/api/orders/${res.orderId}/confirm`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("sold");
    expect(confirm.body.saleId).toBeTruthy();

    const [sale] = await db
      .select({ origin: sales.origin, total: sales.total })
      .from(sales)
      .where(eq(sales.id, confirm.body.saleId))
      .limit(1);
    expect(sale.origin).toBe("order");
    expect(Number(sale.total)).toBe(121000);

    const [p1] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const [p2] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, product2Id))
      .limit(1);
    // Tras la venta simple (Camisa 10→8) la canasta descontó 1 de Camisa (7) y 2 de Pantalón (6→4).
    expect(Number(p1.stock)).toBe(7);
    expect(Number(p2.stock)).toBe(4);
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