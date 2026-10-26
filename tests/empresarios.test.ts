import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { empresariosLeads } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();
const leadEmail = `empresarios-${ts}@example.com`;
let leadId = "";
let adminToken = "";

describe("Cici Empresarios: solicitudes de acceso anticipado", () => {
  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  afterAll(async () => {
    await db.delete(empresariosLeads).where(eq(empresariosLeads.email, leadEmail));
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
});
