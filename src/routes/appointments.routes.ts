// Citas de tiendas BELLEZA: agenda del comerciante, reserva del cliente y
// cambios de estado (cancelar/completar). La reserva vía chat reutiliza
// createBooking() (src/lib/appointments.ts) para validación determinística.
import { Router } from "express";
import { eq, and, gte, lte, asc, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { appointments, sales, stores, storeServices, users } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { createBooking } from "../lib/appointments";
import { createSale } from "../lib/sales";
import { nowInTimezone, dateFromDb, normalizeSchedule } from "../lib/booking";
import { userBlockState, refreshUserModeration } from "../lib/moderation";

const router = Router();

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function daysFrom(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Agenda del comerciante: citas de su tienda entre [from, to].
// Disponible en todos los planes: en FREE el modo es manual (el local atiende
// su agenda personalmente; la IA solo está en planes de pago).
router.get("/agenda", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db
    .select({ id: stores.id, businessType: stores.businessType, schedule: stores.schedule })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  const today = nowInTimezone(normalizeSchedule(store.schedule).timezone).date;
  const fromUsed = DATE_RX.test(from) ? from : today;
  const cFrom = `${fromUsed} 00:00:00`;
  const toUsed = DATE_RX.test(to) ? to : daysFrom(fromUsed, 7);
  const cTo = (() => {
    const [y, m, d] = toUsed.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    const nd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    return `${nd} 00:00:00`;
  })();

  const rows = await db
    .select({
      id: appointments.id,
      appointmentDate: appointments.appointmentDate,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      note: appointments.note,
      saleId: appointments.saleId,
      serviceName: storeServices.name,
      servicePrice: storeServices.price,
      serviceDurationMinutes: storeServices.durationMinutes,
      customerName: users.name,
      customerId: users.id,
    })
    .from(appointments)
    .innerJoin(storeServices, eq(storeServices.id, appointments.serviceId))
    .innerJoin(users, eq(users.id, appointments.customerId))
    .where(
      and(
        eq(appointments.storeId, store.id),
        gte(appointments.appointmentDate, cFrom),
        lte(appointments.appointmentDate, cTo),
      ),
    )
    .orderBy(asc(appointments.appointmentDate), asc(appointments.startTime));

  res.json(
    rows.map((r) => ({
      ...r,
      appointmentDate: dateFromDb(String(r.appointmentDate)),
      service: {
        name: r.serviceName,
        price: Number(r.servicePrice),
        durationMinutes: r.serviceDurationMinutes,
      },
      customer: { id: r.customerId, name: r.customerName },
    })),
  );
});

const bookSchema = z.object({
  storeId: z.string().uuid(),
  serviceId: z.string().uuid(),
  date: z.string().regex(DATE_RX, "Fecha inválida (YYYY-MM-DD)"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:MM)"),
  note: z.string().max(300).optional(),
});

// Cliente reserva una cita (también usado por el flujo de IA vía createBooking).
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Moderación de conducta: un usuario baneado/suspendido también está vetado de
  // RESERVAR citas por la API directa (no solo por el chat), para que no pueda
  // bloquear la agenda de un local.
  await refreshUserModeration(req.userId!);
  const [booker] = await db
    .select({ id: users.id, moderationStatus: users.moderationStatus, moderationUntil: users.moderationUntil })
    .from(users)
    .where(eq(users.id, req.userId!))
    .limit(1);
  const gate = userBlockState(booker ?? { id: req.userId! });
  if (gate.blocked) {
    return res.status(403).json({
      error:
        gate.status === "BANNED"
          ? "Tu cuenta fue expulsada por violar las normas de conducta de la comunidad."
          : "Tu cuenta tiene una sanción activa que impide reservar citas.",
      accountStatus: gate.status,
    });
  }

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, parsed.data.storeId))
    .limit(1);
  if (!store) return res.status(404).json({ error: "La tienda no existe." });

  const result = await createBooking({
    storeId: parsed.data.storeId,
    serviceId: parsed.data.serviceId,
    customerId: req.userId!,
    dateStr: parsed.data.date,
    startTime: parsed.data.startTime,
    note: parsed.data.note ?? null,
  });

  if (!result.ok) {
    return res.status(409).json({ error: result.message, code: result.code });
  }
  res.status(201).json({ ok: true, appointment: result.appointment });
});

// Cancelar una cita (el cliente dueño de la cita o el comerciante). Solo citas
// a futuro sin completar: una cita ya atendida no se puede "deshacer".
router.patch("/:id/cancel", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const [appt] = await db
    .select({ id: appointments.id, storeId: appointments.storeId, customerId: appointments.customerId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, req.params.id))
    .limit(1);
  if (!appt) return res.status(404).json({ error: "Cita no encontrada." });

  const [store] = await db
    .select({ ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, appt.storeId))
    .limit(1);
  const isMerchant = store?.ownerId === req.userId;
  const isCustomer = appt.customerId === req.userId;
  if (!isMerchant && !isCustomer) return res.status(403).json({ error: "No autorizado." });

  if (appt.status === "completed") {
    return res.status(409).json({ error: "La cita ya fue atendida y no se puede cancelar." });
  }
  if (appt.status === "cancelled") {
    return res.status(409).json({ error: "La cita ya está cancelada." });
  }

  await db
    .update(appointments)
    .set({ status: "cancelled" })
    .where(eq(appointments.id, appt.id));
  res.json({ ok: true });
});

type CloseDoneResult =
  | {
      kind: "ok";
      idempotent: boolean;
      appointment: { id: string; status: string; saleId: string | null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: any;
    }
  | { kind: "error"; status: number; error: string };

// Atender una cita ("Listo"): completa Y registra la venta del servicio en UNA
// transacción. Es idempotente vía appointments.saleId — una cita produce como
// máximo una venta. Si algo falla a mitad (inserción de venta, stock…), el
// rollback deja la cita en su estado original: ni "completada sin venta" ni
// venta huérfana. También cierra citas que quedaron "completed" por el endpoint
// viejo /complete sin haber generado venta.
async function closeAsDone(apptId: string, userId: string): Promise<CloseDoneResult> {
  return db.transaction(async (tx) => {
    const [appt] = await tx
      .select({
        id: appointments.id,
        storeId: appointments.storeId,
        serviceId: appointments.serviceId,
        customerId: appointments.customerId,
        status: appointments.status,
        saleId: appointments.saleId,
      })
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);
    if (!appt) return { kind: "error" as const, status: 404, error: "Cita no encontrada." };

    const [store] = await tx
      .select({ ownerId: stores.ownerId })
      .from(stores)
      .where(eq(stores.id, appt.storeId))
      .limit(1);
    if (store?.ownerId !== userId) {
      return { kind: "error" as const, status: 403, error: "No autorizado." };
    }

    if (appt.status === "cancelled") {
      return {
        kind: "error" as const,
        status: 409,
        error: "La cita fue cancelada y no se puede cerrar.",
      };
    }
    if (appt.status === "no_show") {
      return { kind: "error" as const, status: 409, error: "La cita está marcada como 'no vino'." };
    }

    // Idempotencia: si ya tiene venta, devolvemos la existente sin duplicar.
    if (appt.saleId) {
      const [existing] = await tx.select().from(sales).where(eq(sales.id, appt.saleId)).limit(1);
      return {
        kind: "ok" as const,
        idempotent: true,
        appointment: { id: apptId, status: "completed", saleId: appt.saleId },
        sale: existing ? { ...existing, total: Number(existing.total) } : null,
      };
    }

    // Reclamo atómico: evita que dos requests simultáneos generen dos ventas.
    const claimed = await tx
      .update(appointments)
      .set({ status: "completed" })
      .where(
        and(
          eq(appointments.id, apptId),
          isNull(appointments.saleId),
          ne(appointments.status, "cancelled"),
          ne(appointments.status, "no_show"),
        ),
      )
      .returning({ id: appointments.id });

    if (!claimed.length) {
      const [fresh] = await tx
        .select({ status: appointments.status, saleId: appointments.saleId })
        .from(appointments)
        .where(eq(appointments.id, apptId))
        .limit(1);
      if (fresh?.saleId) {
        const [existing] = await tx.select().from(sales).where(eq(sales.id, fresh.saleId)).limit(1);
        return {
          kind: "ok" as const,
          idempotent: true,
          appointment: { id: apptId, status: fresh.status, saleId: fresh.saleId },
          sale: existing ? { ...existing, total: Number(existing.total) } : null,
        };
      }
      return {
        kind: "error" as const,
        status: 409,
        error: "No se pudo cerrar la cita; inténtalo de nuevo.",
      };
    }

    const [svc] = await tx
      .select({ name: storeServices.name })
      .from(storeServices)
      .where(eq(storeServices.id, appt.serviceId))
      .limit(1);

    const saleResult = await createSale(
      {
        storeId: appt.storeId,
        items: [{ serviceId: appt.serviceId, quantity: 1 }],
        note: svc?.name ?? "Servicio",
        customerId: appt.customerId,
        paymentMethod: null,
        origin: "appointment",
      },
      // PgTransaction y NodePgDatabase comparten API; el cast es seguro porque
      // createSale no usa $client (no accede al pool directamente).
      tx as unknown as typeof db,
    );
    if (!saleResult.ok) {
      return { kind: "error" as const, status: saleResult.status, error: saleResult.error };
    }

    await tx
      .update(appointments)
      .set({ saleId: saleResult.sale.id })
      .where(eq(appointments.id, apptId));

    return {
      kind: "ok" as const,
      idempotent: false,
      appointment: { id: apptId, status: "completed", saleId: saleResult.sale.id },
      sale: saleResult.sale,
    };
  });
}

// Alias del endpoint viejo /complete: atiende la cita Y registra la venta con la
// misma transacción que /close ("Listo"). Un solo camino para "atendida".
router.patch("/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const r = await closeAsDone(req.params.id, req.userId!);
  if (r.kind === "error") return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, appointment: r.appointment, sale: r.sale });
});

// Cerrar una cita desde la agenda (solo el comerciante):
//  - outcome "done":    atiende la cita Y registra la venta del servicio. La
//    plata la cobra el comercio por fuera, así que la venta no lleva método.
//  - outcome "no_show": el cliente no vino; cierra sin venta.
const closeSchema = z.object({ outcome: z.enum(["done", "no_show"]) });

router.post("/:id/close", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.outcome === "done") {
    const r = await closeAsDone(req.params.id, req.userId!);
    if (r.kind === "error") return res.status(r.status).json({ error: r.error });
    return res.json({
      ok: true,
      idempotent: r.idempotent,
      appointment: r.appointment,
      sale: r.sale,
    });
  }

  // ── No vino ─────────────────────────────────────────────────────────────
  const [appt] = await db
    .select({
      id: appointments.id,
      storeId: appointments.storeId,
      status: appointments.status,
      saleId: appointments.saleId,
    })
    .from(appointments)
    .where(eq(appointments.id, req.params.id))
    .limit(1);
  if (!appt) return res.status(404).json({ error: "Cita no encontrada." });

  const [store] = await db
    .select({ ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, appt.storeId))
    .limit(1);
  if (store?.ownerId !== req.userId) return res.status(403).json({ error: "No autorizado." });

  if (appt.status === "cancelled") {
    return res.status(409).json({ error: "La cita fue cancelada y no se puede cerrar." });
  }
  if (appt.status === "completed" || appt.saleId) {
    return res.status(409).json({ error: "La cita ya fue atendida y tiene una venta." });
  }
  if (appt.status === "no_show") {
    return res.json({ ok: true, status: "no_show", idempotent: true });
  }

  await db
    .update(appointments)
    .set({ status: "no_show" })
    .where(and(eq(appointments.id, appt.id), eq(appointments.status, "confirmed")));
  return res.json({ ok: true, status: "no_show" });
});

export default router;