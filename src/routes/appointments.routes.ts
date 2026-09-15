// Citas de tiendas BELLEZA: agenda del comerciante, reserva del cliente y
// cambios de estado (cancelar/completar). La reserva vía chat reutiliza
// createBooking() (src/lib/appointments.ts) para validación determinística.
import { Router } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { appointments, stores, storeServices, users } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { createBooking } from "../lib/appointments";
import { nowInTimezone, dateFromDb, DEFAULT_SCHEDULE } from "../lib/booking";
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
router.get("/agenda", requireAuth, async (req: AuthRequest, res) => {
  const [store] = await db
    .select({ id: stores.id, businessType: stores.businessType })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  const today = nowInTimezone(DEFAULT_SCHEDULE.timezone).date;
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

// Completar una cita (solo el comerciante: el servicio se prestó). Solo desde
// "confirmed": una cita cancelada no se puede completar.
router.patch("/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const [appt] = await db
    .select({ id: appointments.id, storeId: appointments.storeId, status: appointments.status })
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
    return res.status(409).json({ error: "La cita fue cancelada y no se puede completar." });
  }

  await db
    .update(appointments)
    .set({ status: "completed" })
    .where(eq(appointments.id, appt.id));
  res.json({ ok: true });
});

export default router;