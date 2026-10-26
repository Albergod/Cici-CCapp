import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { empresariosLeads, users } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const leadEmail = `empresarios-${ts}@example.com`;
const minimalEmail = `empresarios-min-${ts}@example.com`;
const userEmail = `empresarios-user-${ts}@example.com`;
let leadId = "";
let adminToken = "";

describe("Cici Empresarios: solicitudes de acceso anticipado", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  afterAll(async () => {
    await db
      .delete(empresariosLeads)
      .where(inArray(empresariosLeads.email, [leadEmail, minimalEmail]));
    await db.delete(users).where(eq(users.email, userEmail));
  });

  it("registra una solicitud válida y normaliza el correo", async () => {
    const res = await request(app).post("/api/empresarios/leads").send({
      companyName: "Grupo Prueba",
      contactName: "Ana Empresaria",
      email: `Empresarios-${ts}@Example.com`,
      phone: "3001234567",
      storeCount: 4,
      website: "https://grupo-prueba.example.com",
      message: "Tenemos cuatro tiendas y tres equipos.",
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const [row] = await db
      .select()
      .from(empresariosLeads)
      .where(eq(empresariosLeads.email, leadEmail))
      .limit(1);
    expect(row).toBeDefined();
    expect(row.companyName).toBe("Grupo Prueba");
    expect(row.storeCount).toBe(4);
    expect(row.status).toBe("NEW");
    leadId = row.id;
  });

  it("rechaza solicitudes sin empresa o con correo inválido", async () => {
    const noCompany = await request(app).post("/api/empresarios/leads").send({
      companyName: "",
      contactName: "Ana",
      email: "ana@example.com",
    });
    expect(noCompany.status).toBe(400);

    const badEmail = await request(app).post("/api/empresarios/leads").send({
      companyName: "Grupo Prueba",
      contactName: "Ana",
      email: "no-es-correo",
    });
    expect(badEmail.status).toBe(400);
  });

  it("solo el admin puede listar y mover el estado de las solicitudes", async () => {
    const noAuth = await request(app).get("/api/admin/empresarios/leads");
    expect(noAuth.status).toBe(401);

    const login = await request(app)
      .post("/api/admin/login")
      .send({ token: process.env.ADMIN_TOKEN });
    expect(login.status).toBe(200);
    adminToken = login.body.token;

    const list = await request(app)
      .get("/api/admin/empresarios/leads?status=NEW")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.rows.some((row: { id: string }) => row.id === leadId)).toBe(true);

    const patch = await request(app)
      .patch(`/api/admin/empresarios/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONTACTED", notes: "Llamar el martes" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("CONTACTED");
    expect(patch.body.notes).toBe("Llamar el martes");

    const badId = await request(app)
      .patch("/api/admin/empresarios/leads/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONTACTED" });
    expect(badId.status).toBe(400);

    const contacted = await request(app)
      .get("/api/admin/empresarios/leads?status=CONTACTED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(contacted.status).toBe(200);
    expect(contacted.body.rows.some((row: { id: string }) => row.id === leadId)).toBe(true);
  });

  it("acepta opcionales vacíos, coacciona tiendas y guarda el origen", async () => {
    const res = await request(app).post("/api/empresarios/leads").send({
      companyName: "  Grupo Mínimo  ",
      contactName: "  Leo  ",
      email: minimalEmail,
      phone: "   ",
      storeCount: "3",
      website: "   ",
      message: "   ",
    });
    expect(res.status).toBe(201);

    const [row] = await db
      .select()
      .from(empresariosLeads)
      .where(eq(empresariosLeads.email, minimalEmail))
      .limit(1);
    expect(row.companyName).toBe("Grupo Mínimo");
    expect(row.contactName).toBe("Leo");
    expect(row.phone).toBeNull();
    expect(row.storeCount).toBe(3);
    expect(row.website).toBeNull();
    expect(row.message).toBeNull();
    expect(row.source).toBe("landing");
    expect(row.status).toBe("NEW");
  });

  it("rechaza campos faltantes o fuera de rango", async () => {
    const base = {
      companyName: "Grupo Válido",
      contactName: "Ana",
      email: `empresarios-bad-${ts}@example.com`,
    };

    const invalidPayloads = [
      { ...base, contactName: "" },
      { ...base, phone: "1".repeat(31) },
      { ...base, storeCount: 0 },
      { ...base, storeCount: 1.5 },
      { ...base, storeCount: 10001 },
      { ...base, website: "no-es-url" },
      { ...base, message: "m".repeat(1001) },
      { companyName: "Grupo", contactName: "Ana" },
    ];

    for (const payload of invalidPayloads) {
      const res = await request(app).post("/api/empresarios/leads").send(payload);
      expect(res.status).toBe(400);
    }
  });

  it("el admin filtra, pagina, valida y actualiza estados", async () => {
    const invalidStatus = await request(app)
      .get("/api/admin/empresarios/leads?status=INVENTADO")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalidStatus.status).toBe(400);

    const clamped = await request(app)
      .get("/api/admin/empresarios/leads?page=-5&limit=1000")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clamped.status).toBe(200);
    expect(clamped.body.page).toBe(1);
    expect(clamped.body.limit).toBe(100);

    const beyond = await request(app)
      .get("/api/admin/empresarios/leads?page=9999")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(beyond.status).toBe(200);
    expect(beyond.body.rows).toEqual([]);

    const emptyPatch = await request(app)
      .patch(`/api/admin/empresarios/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(emptyPatch.status).toBe(400);

    const badStatus = await request(app)
      .patch(`/api/admin/empresarios/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INVENTADO" });
    expect(badStatus.status).toBe(400);

    const longNotes = await request(app)
      .patch(`/api/admin/empresarios/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "n".repeat(2001) });
    expect(longNotes.status).toBe(400);

    const missing = await request(app)
      .patch(`/api/admin/empresarios/leads/${randomUUID()}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "BETA" });
    expect(missing.status).toBe(404);

    const moved = await request(app)
      .patch(`/api/admin/empresarios/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "BETA" });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe("BETA");

    const beta = await request(app)
      .get("/api/admin/empresarios/leads?status=BETA")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(beta.status).toBe(200);
    expect(beta.body.rows.some((row: { id: string }) => row.id === leadId)).toBe(true);
  });

  it("un token de usuario normal no entra al panel de solicitudes", async () => {
    const register = await request(app).post("/api/auth/register").send({
      email: userEmail,
      password: "demo123456",
      name: "Usuario Normal",
      termsAccepted: true,
    });
    expect(register.status).toBe(201);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: "demo123456" });
    expect(login.status).toBe(200);

    const res = await request(app)
      .get("/api/admin/empresarios/leads")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(401);
  });
});
