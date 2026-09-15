// Helper de citas: validación + creación de una reserva en la agenda de una
// tienda BELLEZA. El chat de la IA y el endpoint público reutilizan esto para
// que el agendamiento sea SIEMPRE determinístico (nunca confiar en la IA).
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { appointments, storeServices, stores } from "../db/schema";
import {
  type BusyAppointment,
  minutesToTime,
  normalizeSchedule,
  timeToMinutes,
  validateSlot,
} from "./booking";
import type { ScheduleConfig } from "../db/schema";

export interface ServiceInfo {
  id: string;
  name: string;
  price: string | number;
  durationMinutes: number;
}

export interface BookingInput {
  storeId: string;
  serviceId: string;
  customerId: string;
  storeBusinessType?: string;
  dateStr: string; // "YYYY-MM-DD" local
  startTime: string; // "HH:MM" local
  note?: string | null;
  now?: { date: string; minutes: number };
}

export type BookingResult =
  | { ok: true; appointment: typeof appointments.$inferSelect; service: ServiceInfo }
  | { ok: false; code: string; message: string };

function localDateStr(dateStr: string): string {
  return `${dateStr} 00:00:00`;
}

/** Citas confirmadas de una tienda en una fecha (para validar solapamientos). */
export async function busyForDate(
  storeId: string,
  dateStr: string,
): Promise<BusyAppointment[]> {
  const rows = await db
    .select({ startTime: appointments.startTime, endTime: appointments.endTime, status: appointments.status })
    .from(appointments)
    .where(and(eq(appointments.storeId, storeId), eq(appointments.appointmentDate, localDateStr(dateStr))));
  return rows.map((r) => ({
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status ?? "confirmed",
  }));
}

/**
 * Crea una reserva. Valida primero con la agenda real (día hábil, horario,
 * almuerzo, pasado, horizonte y solapamiento). Devuelve error code/message si
 * el slot no está disponible; nunca hace un agendamiento inválido.
 */
export async function createBooking(input: BookingInput): Promise<BookingResult> {
  const [store] = await db
    .select({ id: stores.id, schedule: stores.schedule })
    .from(stores)
    .where(eq(stores.id, input.storeId))
    .limit(1);
  if (!store) return { ok: false, code: "store_not_found", message: "La tienda no existe." };

  if (input.storeBusinessType && input.storeBusinessType !== "BELLEZA") {
    return { ok: false, code: "not_booking_store", message: "Esta tienda no agenda citas." };
  }

  const [service] = await db
    .select({ id: storeServices.id, name: storeServices.name, price: storeServices.price, durationMinutes: storeServices.durationMinutes })
    .from(storeServices)
    .where(and(eq(storeServices.id, input.serviceId), eq(storeServices.storeId, input.storeId)))
    .limit(1);
  if (!service) return { ok: false, code: "service_not_found", message: "No conozco ese servicio." };

  const schedule = normalizeSchedule(store.schedule);
  const busy = await busyForDate(input.storeId, input.dateStr);
  const validation = validateSlot({
    schedule: schedule,
    busy,
    dateStr: input.dateStr,
    startTime: input.startTime,
    durationMinutes: service.durationMinutes,
    now: input.now,
  });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const start = timeToMinutes(input.startTime)!;
  const end = start + service.durationMinutes;

  const [appointment] = await db
    .insert(appointments)
    .values({
      storeId: input.storeId,
      serviceId: service.id,
      customerId: input.customerId,
      appointmentDate: localDateStr(input.dateStr),
      startTime: input.startTime,
      endTime: minutesToTime(end),
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (!appointment) {
    return {
      ok: false,
      code: "busy_slot",
      message: "Esa hora ya está tomada. Tengo otros horarios libres.",
    };
  }

  return {
    ok: true,
    appointment,
    service: {
      id: service.id,
      name: service.name,
      price: service.price,
      durationMinutes: service.durationMinutes,
    },
  };
}