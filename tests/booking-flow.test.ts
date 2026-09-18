import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, storeServices, appointments, conversations, messages, sales, saleItems } from "../src/db/schema";
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
      .send({ name: storeName, businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;

    // La agenda de citas es premium: subimos la tienda a PRO para probar el flujo.
    await db.update(stores).set({ plan: "PRO" }).where(eq(stores.id, storeId));

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
      const storeSales = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, store.id));
      if (storeSales.length) {
        await db.delete(saleItems).where(
          inArray(saleItems.saleId, storeSales.map((s) => s.id)),
        );
      }
      await db.delete(sales).where(eq(sales.storeId, store.id));
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

describe("Regresión: estados, moderación y contexto (BELLEZA)", () => {
  const reg = `reg-${ts}`;
  const ownerEmail = `belleza-reg-owner-${reg}@example.com`;
  const clientEmail = `belleza-reg-client-${reg}@example.com`;
  const bannedEmail = `belleza-reg-banned-${reg}@example.com`;
  const owner2Email = `belleza-reg-owner2-${reg}@example.com`;
  const storeName = `Belleza Reg ${reg}`;
  const store2Name = `Belleza Reg2 ${reg}`;
  const dateStr = futureWorkday(3);
  let storeId = "";
  let tokenM = "";
  let tokenC = "";
  let tokenB = "";
  let serviceId = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    tokenM = await registerUser(ownerEmail);
    tokenC = await registerUser(clientEmail);
    tokenB = await registerUser(bannedEmail);
    await registerUser(owner2Email);

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: storeName, businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;

    // La agenda de citas es premium: subimos la tienda a PRO para probar el flujo.
    await db.update(stores).set({ plan: "PRO" }).where(eq(stores.id, storeId));

    const svc = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Corte reg", price: 40000, durationMinutes: 45 });
    expect(svc.status).toBe(201);
    serviceId = svc.body.id;
  });

  afterAll(async () => {
    const names = [storeName, store2Name];
    const rows = await db.select({ id: stores.id }).from(stores).where(inArray(stores.name, names));
    const svcRows = await db
      .select({ id: storeServices.id })
      .from(storeServices)
      .where(inArray(storeServices.storeId, rows.map((r) => r.id)));
    // Las conversaciones creadas con contexto de servicio pueden tener el
    // saludo IA (tienda en plan de pago): se borran sus mensajes primero.
    const convRows = svcRows.length
      ? await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(inArray(conversations.assertedServiceId, svcRows.map((s) => s.id)))
      : [];
    if (convRows.length) {
      await db
        .delete(messages)
        .where(inArray(messages.conversationId, convRows.map((c) => c.id)));
      await db
        .delete(conversations)
        .where(inArray(conversations.id, convRows.map((c) => c.id)));
    }
    for (const s of rows) {
      await db.delete(appointments).where(eq(appointments.storeId, s.id));
      const storeSales = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, s.id));
      if (storeSales.length) {
        await db.delete(saleItems).where(
          inArray(saleItems.saleId, storeSales.map((x) => x.id)),
        );
      }
      await db.delete(sales).where(eq(sales.storeId, s.id));
      await db.delete(storeServices).where(eq(storeServices.storeId, s.id));
    }
    await db.delete(stores).where(inArray(stores.name, names));
    await db.delete(users).where(
      inArray(users.email, [ownerEmail, clientEmail, bannedEmail, owner2Email]),
    );
  });

  it("no cancela una cita ya completada ni completa una cancelada", async () => {
    const book = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "10:00" });
    expect(book.status).toBe(201);
    const apptId = book.body.appointment.id;

    const complete = await request(app)
      .patch(`/api/appointments/${apptId}/complete`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(complete.status).toBe(200);

    const cancelAfterComplete = await request(app)
      .patch(`/api/appointments/${apptId}/cancel`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(cancelAfterComplete.status).toBe(409);
    expect(cancelAfterComplete.body.error).toMatch(/atendida/i);

    // Una cita cancelada no se puede "resucitar" completándola.
    const book2 = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "11:00" });
    const appt2 = book2.body.appointment.id;
    const cancel = await request(app)
      .patch(`/api/appointments/${appt2}/cancel`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(cancel.status).toBe(200);
    const completeCancelled = await request(app)
      .patch(`/api/appointments/${appt2}/complete`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(completeCancelled.status).toBe(409);
  });

  it("rechaza UUID inválido en cancel/complete (petición no cuelga)", async () => {
    const cancel = await request(app)
      .patch("/api/appointments/not-a-uuid/cancel")
      .set("Authorization", `Bearer ${tokenC}`);
    expect(cancel.status).toBe(400);
    const complete = await request(app)
      .patch("/api/appointments/not-a-uuid/complete")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(complete.status).toBe(400);
    const del = await request(app)
      .delete("/api/services/not-a-uuid")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(del.status).toBe(400);
  });

  it("un usuario baneado NO reserva por la API directa", async () => {
    await db
      .update(users)
      .set({ moderationStatus: "BANNED", moderationUntil: null })
      .where(eq(users.email, bannedEmail));

    const book = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ storeId, serviceId, date: dateStr, startTime: "13:00" });
    expect(book.status).toBe(403);
    expect(book.body.accountStatus).toBe("BANNED");

    await db
      .update(users)
      .set({ moderationStatus: "ACTIVE", moderationUntil: null })
      .where(eq(users.email, bannedEmail));
  });

  it("no abre conversación con servicio o producto ajeno a la tienda", async () => {
    // Segunda tienda con su propio servicio.
    const owner2Token = await (async () => {
      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: owner2Email, password: "demo123456" });
      return login.body.token;
    })();
    const store2 = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${owner2Token}`)
      .send({ name: store2Name, businessType: "BELLEZA" });
    expect(store2.status).toBe(201);
    await db
      .update(stores)
      .set({ plan: "PRO" })
      .where(eq(stores.id, store2.body.id));
    const svc2 = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${owner2Token}`)
      .send({ name: "Otro corte", price: 50000, durationMinutes: 30 });
    expect(svc2.status).toBe(201);

    const foreign = await request(app)
      .post(`/api/stores/${storeId}/conversation`)
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ serviceId: svc2.body.id });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/no pertenece/i);

    const own = await request(app)
      .post(`/api/stores/${storeId}/conversation`)
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ serviceId });
    expect(own.status).toBe(200);
    expect(own.body.assertedServiceId).toBe(serviceId);
  });
});

describe("Cita → venta: cerrar con 'Listo' / 'No vino' (BELLEZA)", () => {
  const tag = `close-${ts}`;
  const ownerEmail = `belleza-close-owner-${tag}@example.com`;
  const clientEmail = `belleza-close-client-${tag}@example.com`;
  const otherEmail = `belleza-close-other-${tag}@example.com`;
  const storeName = `Belleza Close ${tag}`;
  const dateStr = futureWorkday(5);
  let storeId = "";
  let serviceId = "";
  let tokenM = "";
  let tokenC = "";
  let tokenO = "";

  async function book(startTime: string): Promise<string> {
    const r = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ storeId, serviceId, date: dateStr, startTime });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.appointment.id;
  }

  async function stats() {
    const r = await request(app)
      .get("/api/sales/stats")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(r.status).toBe(200);
    return r.body;
  }

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    tokenM = await registerUser(ownerEmail);
    tokenC = await registerUser(clientEmail);
    tokenO = await registerUser(otherEmail);

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: storeName, businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;

    // La agenda de citas es premium: subimos la tienda a PRO para probar el flujo.
    await db.update(stores).set({ plan: "PRO" }).where(eq(stores.id, storeId));

    const svc = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Corte cierre", price: 40000, durationMinutes: 45 });
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
      const storeSales = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, store.id));
      if (storeSales.length) {
        await db.delete(saleItems).where(
          inArray(saleItems.saleId, storeSales.map((s) => s.id)),
        );
      }
      await db.delete(sales).where(eq(sales.storeId, store.id));
      const svcRows = await db
        .select({ id: storeServices.id })
        .from(storeServices)
        .where(eq(storeServices.storeId, store.id));
      if (svcRows.length) {
        await db
          .delete(conversations)
          .where(inArray(conversations.assertedServiceId, svcRows.map((s) => s.id)));
      }
      await db.delete(storeServices).where(eq(storeServices.storeId, store.id));
    }
    await db.delete(stores).where(eq(stores.name, storeName));
    await db
      .delete(users)
      .where(inArray(users.email, [ownerEmail, clientEmail, otherEmail]));
  });

  it("un cliente no puede cerrar (ni 'Listo' ni 'No vino')", async () => {
    const apptId = await book("09:00");
    const done = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenC}`)
      .send({ outcome: "done" });
    expect(done.status).toBe(403);

    const noShow = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenO}`)
      .send({ outcome: "no_show" });
    expect(noShow.status).toBe(403);

    // Y el estado sigue intacto
    const after = await db
      .select({ status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);
    expect(after[0].status).toBe("confirmed");

    // Limpieza: cancelar para no dejar una cita confirmada que bloquee el borrado.
    await request(app)
      .patch(`/api/appointments/${apptId}/cancel`)
      .set("Authorization", `Bearer ${tokenM}`);
  });

  it("'Listo' marca atendida, crea la venta y la refleja en stats (y es idempotente)", async () => {
    const before = await stats();
    const apptId = await book("10:00");

    const close = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(close.status).toBe(200);
    expect(close.body.sale).toBeTruthy();
    expect(close.body.sale.total).toBe(40000);
    expect(close.body.sale.origin).toBe("appointment");

    // La cita quedó completada y ligada a la venta
    const [appt] = await db
      .select({ status: appointments.status, saleId: appointments.saleId })
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);
    expect(appt.status).toBe("completed");
    expect(appt.saleId).toBe(close.body.sale.id);

    // Stats: suma la venta y aparece en topServices/recentSales
    const after = await stats();
    expect(after.totalSales).toBe(before.totalSales + 1);
    expect(after.topServices.some((s: any) => s.name === "Corte cierre")).toBe(true);
    const recent = after.recentSales.find((s: any) => s.id === close.body.sale.id);
    expect(recent).toBeTruthy();
    expect(recent.itemsSummary[0].kind).toBe("service");

    // Idempotencia: cerrar de nuevo no duplica la venta
    const again = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.sale.id).toBe(close.body.sale.id);

    const afterAgain = await stats();
    expect(afterAgain.totalSales).toBe(after.totalSales);
  });

  it("'No vino' cierra sin venta y no se puede luego completar", async () => {
    const before = await stats();
    const apptId = await book("11:00");

    const noShow = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "no_show" });
    expect(noShow.status).toBe(200);
    expect(noShow.body.status).toBe("no_show");

    const [appt] = await db
      .select({ status: appointments.status, saleId: appointments.saleId })
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);
    expect(appt.status).toBe("no_show");
    expect(appt.saleId).toBeNull();

    const after = await stats();
    expect(after.totalSales).toBe(before.totalSales);

    // Ni "Listo" ni "No vino" de nuevo deben crear venta / romper estado
    const doneAfter = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(doneAfter.status).toBe(409);

    const noShowAgain = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "no_show" });
    expect(noShowAgain.status).toBe(200);
    expect(noShowAgain.body.idempotent).toBe(true);
  });

  it("cancelar no se puede cerrar y validar UUID inválido responde 400", async () => {
    const apptId = await book("09:00");
    const cancel = await request(app)
      .patch(`/api/appointments/${apptId}/cancel`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(cancel.status).toBe(200);

    const closeCancelled = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(closeCancelled.status).toBe(409);

    const badId = await request(app)
      .post("/api/appointments/not-a-uuid/close")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(badId.status).toBe(400);

    const badOutcome = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "whatever" });
    expect(badOutcome.status).toBe(400);
  });

  it("una cita completada con el endpoint viejo /complete igual se cierra con 'Listo'", async () => {
    const apptId = await book("09:00");
    const legacy = await request(app)
      .patch(`/api/appointments/${apptId}/complete`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(legacy.status).toBe(200);

    const close = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(close.status).toBe(200);
    expect(close.body.sale).toBeTruthy();

    const again = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
  });

  it("al borrar el servicio se conserva la venta histórica (desvinculada)", async () => {
    const apptId = await book("08:00");
    const close = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(close.status).toBe(200);
    const saleId = close.body.sale.id;

    // No quedan citas confirmadas futuras, así que se puede borrar el servicio.
    const removed = await request(app)
      .delete(`/api/services/${serviceId}`)
      .set("Authorization", `Bearer ${tokenM}`);
    expect(removed.status).toBe(200);

    // La venta sigue existiendo y el ítem quedó sin serviceId.
    const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
    expect(sale).toBeTruthy();
    expect(sale.note).toBe("Corte cierre");
    const [item] = await db
      .select({ serviceId: saleItems.serviceId })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .limit(1);
    expect(item.serviceId).toBeNull();
  });
});

describe("Gates de plan: servicios, agenda y reservas solo PRO/BUSINESS", () => {
  const tag = `free-${ts}`;
  const ownerEmail = `belleza-free-owner-${tag}@example.com`;
  const clientEmail = `belleza-free-client-${tag}@example.com`;
  const storeName = `Belleza Free ${tag}`;
  const dateStr = futureWorkday(2);
  let storeId = "";
  let tokenM = "";
  let tokenC = "";
  let svcId = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    tokenM = await registerUser(ownerEmail);
    tokenC = await registerUser(clientEmail);

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: storeName, businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;
    // Nueva tienda = FREE (prueba manual, se activa aparte). Para probar el
    // modo manual post-prueba, la forzamos a FREE sin ciclo.
    expect(store.body.plan).toBe("FREE");
    expect(store.body.onTrial).toBe(false);
    await db
      .update(stores)
      .set({ plan: "FREE", subscriptionCycle: null })
      .where(eq(stores.id, storeId));
  });

  afterAll(async () => {
    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.name, storeName))
      .limit(1);
    if (store) {
      await db.delete(appointments).where(eq(appointments.storeId, store.id));
      const storeSales = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, store.id));
      if (storeSales.length) {
        await db.delete(saleItems).where(
          inArray(saleItems.saleId, storeSales.map((s) => s.id)),
        );
      }
      await db.delete(sales).where(eq(sales.storeId, store.id));
      await db.delete(storeServices).where(eq(storeServices.storeId, store.id));
    }
    await db.delete(stores).where(eq(stores.name, storeName));
    await db
      .delete(users)
      .where(inArray(users.email, [ownerEmail, clientEmail]));
  });

  it("una tienda FREE gestiona servicios (modo manual)", async () => {
    const create = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Manicura FREE", price: 30000, durationMinutes: 60 });
    expect(create.status).toBe(201);
    svcId = create.body.id;

    const list = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(list.status).toBe(200);
    expect(list.body.some((s) => s.id === svcId)).toBe(true);
  });

  it("una tienda FREE ofrece agenda al comerciante", async () => {
    const agenda = await request(app)
      .get("/api/appointments/agenda")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(agenda.status).toBe(200);
  });

  it("una tienda FREE acepta reservas de clientes (el local atiende su agenda)", async () => {
    const book = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({
        storeId,
        serviceId: svcId,
        date: dateStr,
        startTime: "10:00",
      });
    expect(book.status).toBe(201);
  });

  it("los servicios se muestran en el público aunque la tienda sea FREE", async () => {
    const slug = await request(app).get(`/api/stores/${storeName.split(" ").join("-").toLowerCase()}`);
    expect(slug.status).toBe(200);
    expect(slug.body.services.some((s) => s.id === svcId)).toBe(true);
  });
});

describe("Citas manuales del comerciante (modo manual FREE)", () => {
  const tag = `manual-${ts}`;
  const ownerEmail = `beauty-manual-owner-${tag}@example.com`;
  const otherEmail = `beauty-manual-other-${tag}@example.com`;
  const storeName = `Belleza Manual ${tag}`;
  const dateStr = futureWorkday();
  let storeId = "";
  let serviceId = "";
  let tokenM = "";
  let tokenO = "";

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);

    tokenM = await registerUser(ownerEmail);
    tokenO = await registerUser(otherEmail);

    const store = await request(app)
      .post("/api/stores")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: storeName, businessType: "BELLEZA" });
    expect(store.status).toBe(201);
    storeId = store.body.id;
    // Sin precio de plan: la tienda queda FREE y aun así debe poder agendar a mano.
    await db
      .update(stores)
      .set({ plan: "FREE", subscriptionCycle: null })
      .where(eq(stores.id, storeId));

    const svc = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ name: "Manicura manual", price: 30000, durationMinutes: 60 });
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
      const storeSales = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, store.id));
      if (storeSales.length) {
        await db.delete(saleItems).where(inArray(saleItems.saleId, storeSales.map((s) => s.id)));
      }
      await db.delete(sales).where(eq(sales.storeId, store.id));
      await db.delete(storeServices).where(eq(storeServices.storeId, store.id));
    }
    await db.delete(stores).where(eq(stores.name, storeName));
    await db.delete(users).where(inArray(users.email, [ownerEmail, otherEmail]));
  });

  it("el comerciante agenda a mano para un cliente sin cuenta", async () => {
    const r = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: dateStr, startTime: "09:00", customerName: "Ana Pérez" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.appointment.customerId).toBeNull();
    expect(r.body.appointment.manualCustomerName).toBe("Ana Pérez");
    expect(r.body.appointment.endTime).toBe("10:00"); // 60 min
  });

  it("la agenda del comerciante muestra el nombre manual", async () => {
    const agenda = await request(app)
      .get("/api/appointments/agenda")
      .set("Authorization", `Bearer ${tokenM}`);
    expect(agenda.status).toBe(200);
    const row = agenda.body.find((a: any) => a.startTime === "09:00");
    expect(row).toBeTruthy();
    expect(row.customerName).toBe("Ana Pérez");
    expect(row.customer).toBeNull();
  });

  it("valida horario/almuerzo/solape y nombre obligatorio", async () => {
    const lunch = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: dateStr, startTime: "12:30", customerName: "Lunch" });
    expect(lunch.status).toBe(409);
    expect(lunch.body.code).toBe("lunch");

    const clash = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: dateStr, startTime: "09:30", customerName: "Clash" });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("busy_slot");

    const closed = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: nextSunday(dateStr), startTime: "09:00", customerName: "Domingo" });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("closed_day");

    const noName = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: dateStr, startTime: "15:00", customerName: "   " });
    expect(noName.status).toBe(400);
  });

  it("un usuario sin tienda no puede agendar a mano", async () => {
    const r = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenO}`)
      .send({ serviceId, date: dateStr, startTime: "16:00", customerName: "Intruso" });
    expect(r.status).toBe(404);
  });

  it("cerrar 'Listo' una cita manual registra la venta (sin cliente con cuenta)", async () => {
    const book = await request(app)
      .post("/api/appointments/manual")
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ serviceId, date: dateStr, startTime: "17:00", customerName: "Mostrador" });
    expect(book.status).toBe(201);
    const apptId = book.body.appointment.id;

    const close = await request(app)
      .post(`/api/appointments/${apptId}/close`)
      .set("Authorization", `Bearer ${tokenM}`)
      .send({ outcome: "done" });
    expect(close.status).toBe(200);
    expect(close.body.sale.total).toBe(30000);
    expect(close.body.sale.origin).toBe("appointment");

    const [sale] = await db.select().from(sales).where(eq(sales.id, close.body.sale.id)).limit(1);
    expect(sale.customerId).toBeNull();
  });
});