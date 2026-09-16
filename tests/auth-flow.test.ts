import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { checkProfanityList } from "../src/lib/moderation";
import { db } from "../src/db/client";
import { users, stores } from "../src/db/schema";
import "dotenv/config";

let app: Express;

// Simula el paso del tiempo: expira la sanción de moderación del usuario y
// restaura sus tiendas (como hace refreshUserModeration/refreshStoreStatus).
async function expireSanctions(email: string) {
  await db
    .update(users)
    .set({ moderationStatus: "ACTIVE", moderationUntil: null })
    .where(eq(users.email, email));
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (u) {
    await db
      .update(stores)
      .set({ status: "ACTIVE", suspensionEndsAt: null, sanctionsCount: 0 })
      .where(eq(stores.ownerId, u.id));
  }
}

describe("Flujo crítico (LOGIN → CREAR TIENDA → CHECKOUT)", () => {
  beforeAll(async () => {
    // Importar el código TS directamente usando esm.
    // vitest usa esbuild para transformar.
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  it("debe permitir registro y login", async () => {
    const email = `test-${Date.now()}@example.com`;
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Test User",
      termsAccepted: true,
    });
    const r = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeDefined();
    expect(r.body.user.moderationStatus).toBe("ACTIVE");
  });

  it("rechaza el registro sin aceptar los Términos y Condiciones", async () => {
    const r = await request(app).post("/api/auth/register").send({
      email: `no-tyc-${Date.now()}@example.com`,
      password: "demo123456",
      name: "Sin TyC",
    });
    expect(r.status).toBe(400);
  });

  it("debe crear una tienda en prueba gratis (plan PRO abierto por 14 días)", async () => {
    const email = `store-${Date.now()}@example.com`;
    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Store Owner",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    const token = login.body.token;

    const r = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tienda Test", description: "Test", businessType: "OTRO" });
    expect(r.status).toBe(201);
    expect(r.body.plan).toBe("PRO");
    expect(r.body.subscriptionCycle).toBeNull();
    expect(r.body.onTrial).toBe(true);
    expect(r.body.trialEndsAt).toBeDefined();
    // En prueba gratis aún no hay código de referido.
    expect(r.body.referralCode).toBeNull();
  });
});

describe("Moderación del chat", () => {
  it("la lista de groserías distingue normal, blanda y dura", () => {
    expect(checkProfanityList("hola, me interesa el producto")).toEqual({
      flagged: false,
      hard: false,
    });
    expect(checkProfanityList("eso es una gonorrea horrible").flagged).toBe(true);
    expect(checkProfanityList("eso es una gonorrea horrible").hard).toBe(false);
    expect(checkProfanityList("que hijueputa").flagged).toBe(true);
    expect(checkProfanityList("hpta").flagged).toBe(true);
    expect(checkProfanityList("te voy a matar hijo de perra").hard).toBe(true);
  });

  it("escalera de castigos: aviso → mute → suspensión → expulsión", async () => {
    const email = `chat-${Date.now()}@example.com`;

    const reg = await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Chat User",
      termsAccepted: true,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    const token = login.body.token;

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tienda Chat", description: "Test", businessType: "OTRO" });
    expect(store.status).toBe(201);

    const conv = await request(app)
      .post(`/api/stores/${store.body.id}/conversation`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(conv.status).toBe(200);
    const convId = conv.body.id;

    // La sanción se aplica al momento: tras el AVISO el usuario sigue activo;
    // tras el MUTE ya no puede enviar (fricción antes que castigo). Se simula
    // el paso del tiempo (expiraSanción) para llegar a la suspensión y al ban.
    let r = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "eres una gonorrea insoportable" });
    expect(r.status).toBe(403);
    expect(r.body.action).toBe("warning");

    r = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "eres una gonorrea insoportable" });
    expect(r.status).toBe(403);
    expect(r.body.action).toBe("mute");
    expect(r.body.until).toBeDefined();

    // Durante el MUTE los mensajes se rechazan por estado, sin sumar falta.
    r = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "eres una gonorrea insoportable" });
    expect(r.status).toBe(403);
    expect(r.body.accountStatus).toBe("MUTED");
    expect(r.body.action).toBeUndefined();

    // Pasa el mute → siguiente falta = SUSPENSIÓN (y la tienda se suspende).
    await expireSanctions(email);
    r = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "eres una gonorrea insoportable" });
    expect(r.status).toBe(403);
    expect(r.body.action).toBe("suspension");

    const suspendedStore = await request(app)
      .get(`/api/stores/${store.body.slug}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suspendedStore.status).toBe(200);
    expect(suspendedStore.body.status).toBe("SUSPENDED");

    // Pasa la suspensión → siguiente falta = EXPULSIÓN permanente.
    await expireSanctions(email);
    r = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "eres una gonorrea insoportable" });
    expect(r.status).toBe(403);
    expect(r.body.action).toBe("ban");

    // Expulsado: el login queda prohibido.
    const banned = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    expect(banned.status).toBe(403);
    expect(banned.body.accountStatus).toBe("BANNED");
  });

  it("un contenido grave expulsa de inmediato, sin escalera", async () => {
    const email = `hard-${Date.now()}@example.com`;

    await request(app).post("/api/auth/register").send({
      email,
      password: "demo123456",
      name: "Grave User",
      termsAccepted: true,
    });
    const login = await request(app).post("/api/auth/login").send({
      email,
      password: "demo123456",
    });
    const token = login.body.token;

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tienda Grave", description: "Test", businessType: "OTRO" });

    const conv = await request(app)
      .post(`/api/stores/${store.body.id}/conversation`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const r = await request(app)
      .post(`/api/conversations/${conv.body.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "te voy a matar si no me vendes mas barato" });

    expect(r.status).toBe(403);
    expect(r.body.action).toBe("ban");
  });
});