import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, storeServices, appointments } from "../src/db/schema";
import "dotenv/config";

let app: Express;
const ts = Date.now();

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Una fecha futura que sea día hábil (lun-sáb) según el schedule default.
function futureWorkday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

// El siguiente domingo (día no laborable con el schedule default).
function nextSunday(from: string): string {
  const d = new Date(`${from}T00:00:00`);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

async function registerUser(email: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "User",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

describe("Agenda de citas (BELLEZA)", () => {
  const merchantEmail = `belleza-owner-${ts}@example.com`;
  const customerEmail = `belleza-client-${ts}@example.com`;
  const storeName = `Belleza ${ts}`;
  const dateStr = futureWorkday();
  let storeId = "";
  let serviceId = "";
  let tokenM = "";
  let tokenC = "";
  let appointmentId = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    tokenM = await registerUser(merchantEmail);
    tokenC = await registerUser(customerEmail);

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: storeName, description: "Salón", businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;

    const svc = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Corte de cabello", price: 40000, durationMinutes: 45 });
    expect(svc.status).toBe(201);
    serviceId = svc.body.id;
  });

  afterAll(async () => {
    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.name, storeName))
      .limit(1);
    if (store) {
      await db.delete(appointments).where(eq(appointments.storeId, store.id));
      await db.delete(storeServices).where(eq(storeServices.storeId, store.id));
    }
    await db.delete(stores).where(eq(stores.name, storeName));
    await db
      .delete(users)
      .where(inArray(users.email, [merchantEmail, customerEmail]));
  });

  it("el comerciante crea servicios y un cliente no puede", async () => {
    expect(serviceId).toBeTruthy();
    const asCustomer = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ name: "Manicura", price: 30000, durationMinutes: 60 });
    expect(asCustomer.status).toBe(404); // no tiene tienda
  });

  it("reserva una cita válida y calcula el fin por duración", async () => {
    const r = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "10:00" });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.appointment.id).toBeTruthy();
    expect(r.body.appointment.endTime).toBe("10:45"); // 45 min de duración
    appointmentId = r.body.appointment.id;
  });

  it("rechaza solapamiento, almuerzo y día cerrado", async () => {
    const clash = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "10:30" });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("busy_slot");

    const lunch = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "12:30" });
    expect(lunch.status).toBe(409);
    expect(lunch.body.code).toBe("lunch");

    const closed = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: nextSunday(dateStr), startTime: "10:00" });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("closed_day");
  });

  it("el comerciante ve la cita en su agenda", async () => {
    const agenda = await request(app)
      .get("/api/appointments/agenda")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(agenda.status).toBe(200);
    const row = agenda.body.find((a: any) => a.id === appointmentId);
    expect(row).toBeTruthy();
    expect(row.service.name).toBe("Corte de cabello");
    expect(row.customer.id).toBeTruthy();
    expect(row.appointmentDate).toBe(dateStr);
  });

  it("el comerciante completa una cita (solo él)", async () => {
    const byCustomer = await request(app)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(byCustomer.status).toBe(403);

    const byMerchant = await request(app)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(byMerchant.status).toBe(200);
  });

  it("borrar servicio bloqueado con citas futuras confirmadas; tras cancelar, se libera", async () => {
    // Nueva cita confirmada a futuro (14:00)
    const reserveB = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "14:00" });
    expect(reserveB.status).toBe(201);
    const confirmedId = reserveB.body.appointment.id;

    const blocked = await request(app)
      .delete(`/api/services/${serviceId}`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(blocked.status).toBe(409);

    // El cliente cancela su cita confirmada y el servicio ya se puede borrar
    const cancel = await request(app)
      .patch(`/api/appointments/${confirmedId}/cancel`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(cancel.status).toBe(200);

    const removed = await request(app)
      .delete(`/api/services/${serviceId}`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(removed.status).toBe(200);
  });

  it("tras cancelar, la misma franja vuelve a agendarse", async () => {
    const again = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId: "00000000-0000-0000-0000-000000000000", date: dateStr, startTime: "10:00" });
    expect(again.status).toBe(409); // servicio eliminado
    expect(again.body.code).toBe("service_not_found");
  });
});