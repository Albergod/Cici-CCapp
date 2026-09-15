// Lógica de agenda para tiendas BELLEZA.
// - El horario vive en stores.schedule (JSONB). No usamos la zona horaria del
//   servidor para decidir "la hora local": la calculamos desde la zona que el
//   comerciante configura (default America/Bogota), así "hoy a las N" es la
//   hora local de la tienda aunque el servidor corra en UTC.
// - Una cita ocupa [start, start+duration) dentro del día. Nunca se agenda en
//   el almuerzo [lunchStart, lunchEnd), ni fuera de horario, ni en día no
//   laborable, ni en el pasado, ni más allá del bookingHorizonDays.

import type { ScheduleConfig } from "../db/schema";

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  openTime: "08:00",
  closeTime: "21:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  workingDays: [1, 2, 3, 4, 5, 6], // 0 = domingo … 6 = sábado
  bookingHorizonDays: 30,
  timezone: "America/Bogota",
};

export function normalizeSchedule(raw: Partial<ScheduleConfig> | null | undefined): ScheduleConfig {
  const s = raw ?? {};
  return {
    openTime: s.openTime ?? DEFAULT_SCHEDULE.openTime,
    closeTime: s.closeTime ?? DEFAULT_SCHEDULE.closeTime,
    lunchStart: s.lunchStart ?? DEFAULT_SCHEDULE.lunchStart,
    lunchEnd: s.lunchEnd ?? DEFAULT_SCHEDULE.lunchEnd,
    workingDays:
      s.workingDays && s.workingDays.length ? [...new Set(s.workingDays)].sort() : DEFAULT_SCHEDULE.workingDays,
    bookingHorizonDays: s.bookingHorizonDays ?? DEFAULT_SCHEDULE.bookingHorizonDays,
    timezone: s.timezone ?? DEFAULT_SCHEDULE.timezone,
  };
}

/** "HH:MM" → minutos desde las 00:00. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** minutos → "HH:MM". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Fecha y minutos locales actuales en la zona configurada. */
export function nowInTimezone(tz: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date())) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const h24 = parts.hour === 24 ? 0 : parts.hour;
  return {
    date: `${pad(parts.year)}-${pad(parts.month)}-${pad(parts.day)}`,
    minutes: h24 * 60 + (parts.minute ?? 0),
  };
}

/** Día de la semana de una fecha "YYYY-MM-DD" (0 = domingo). */
export function weekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay();
}

export function isWorkingDay(schedule: ScheduleConfig, dateStr: string): boolean {
  return schedule.workingDays.includes(weekdayOf(dateStr));
}

/** ¿Pasa en el pasado? (según la hora local configurada). */
export function isBeforeNow(tz: string, dateStr: string, minutes: number): boolean {
  const now = nowInTimezone(tz);
  if (dateStr < now.date) return true;
  if (dateStr === now.date && minutes < now.minutes) return true;
  return false;
}

export type BusyAppointment = {
  startTime: string;
  endTime: string;
  status?: string | null;
};

/** ¿La franja [start, end) choca con alguna cita confirmada del día? */
export function slotConflicts(
  busy: BusyAppointment[],
  startMinutes: number,
  endMinutes: number,
): boolean {
  for (const b of busy) {
    if (b.status === "cancelled") continue;
    const bs = timeToMinutes(b.startTime);
    const be = timeToMinutes(b.endTime);
    if (bs === null || be === null) continue;
    if (startMinutes < be && endMinutes > bs) return true;
  }
  return false;
}

export type SlotValidation =
  | { ok: true }
  | { ok: false; code: "service_not_found"; message: string }
  | { ok: false; code: "closed_day"; message: string }
  | { ok: false; code: "closed_hours"; message: string }
  | { ok: false; code: "lunch"; message: string }
  | { ok: false; code: "past"; message: string }
  | { ok: false; code: "beyond_horizon"; message: string }
  | { ok: false; code: "invalid_time"; message: string }
  | { ok: false; code: "busy_slot"; message: string };

export interface ValidateSlotInput {
  schedule: ScheduleConfig;
  busy: BusyAppointment[];
  dateStr: string; // "YYYY-MM-DD" (local de la tienda)
  startTime: string; // "HH:MM" que propone el cliente
  durationMinutes: number;
  now?: { date: string; minutes: number };
}

/**
 * Valida una cita: día laborable, dentro del horario, fuera de almuerzo, no en
 * el pasado, dentro del horizonte y sin conflicto de franja.
 */
export function validateSlot({
  schedule,
  busy,
  dateStr,
  startTime,
  durationMinutes,
  now,
}: ValidateSlotInput): SlotValidation {
  const start = timeToMinutes(startTime);
  if (start === null) return { ok: false, code: "invalid_time", message: "Esa hora no es válida." };
  if (durationMinutes <= 0) return { ok: false, code: "invalid_time", message: "La duración del servicio no es válida." };
  const end = start + durationMinutes;
  const open = timeToMinutes(schedule.openTime) ?? 0;
  const close = timeToMinutes(schedule.closeTime) ?? 1440;
  const lunchStart = timeToMinutes(schedule.lunchStart) ?? timeToMinutes("12:00") ?? 720;
  const lunchEnd = timeToMinutes(schedule.lunchEnd) ?? 780;

  if (!isWorkingDay(schedule, dateStr)) {
    return { ok: false, code: "closed_day", message: "Ese día no abrimos. Elige otro día." };
  }
  if (start < open || end > close) {
    return {
      ok: false,
      code: "closed_hours",
      message: `Esa hora queda fuera de nuestro horario de atención (${schedule.openTime} a ${schedule.closeTime}).`,
    };
  }
  // El almuerzo no se agenda: descartamos cualquier franja que lo toque.
  if (start < lunchEnd && end > lunchStart) {
    return {
      ok: false,
      code: "lunch",
      message: `Esa hora cae en nuestro horario de almuerzo (${schedule.lunchStart} a ${schedule.lunchEnd}). ¿Puedes otro horario?`,
    };
  }

  const refNow = now ?? nowInTimezone(schedule.timezone);
  if (dateStr < refNow.date || (dateStr === refNow.date && start < refNow.minutes)) {
    return { ok: false, code: "past", message: "Esa hora ya pasó. Elige una hora disponible más adelante." };
  }

  // Horizonte: no reservar más allá de bookingHorizonDays contados desde hoy.
  const today = new Date(`${refNow.date}T00:00:00`);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > schedule.bookingHorizonDays) {
    return {
      ok: false,
      code: "beyond_horizon",
      message: `Solo podemos agendar hasta ${schedule.bookingHorizonDays} días adelante.`,
    };
  }

  if (slotConflicts(busy, start, end)) {
    return { ok: false, code: "busy_slot", message: "Esa hora ya está tomada. Tengo otros horarios libres." };
  }

  return { ok: true };
}

/** Franjas libres de un día (inicios "HH:MM"), barriendo desde el open. */
export function freeSlotsForDate({
  schedule,
  busy,
  durationMinutes,
  dateStr,
  limit = 8,
}: {
  schedule: ScheduleConfig;
  busy: BusyAppointment[];
  durationMinutes: number;
  dateStr: string;
  limit?: number;
}): string[] {
  const open = timeToMinutes(schedule.openTime) ?? 0;
  const close = timeToMinutes(schedule.closeTime) ?? 1440;
  const lunchStart = timeToMinutes(schedule.lunchStart) ?? 720;
  const lunchEnd = timeToMinutes(schedule.lunchEnd) ?? 780;
  const out: string[] = [];
  const night = 24 * 60;
  let cursor = open;
  while (cursor + durationMinutes <= close && out.length < limit) {
    const end = cursor + durationMinutes;
    if (!(cursor < lunchEnd && end > lunchStart) && !slotConflicts(busy, cursor, end)) {
      out.push(minutesToTime(cursor));
    }
    // Avance de 30 min: permite empezar en :00 y :30, y evita infinitos.
    cursor += 30;
    if (cursor >= night) break;
  }
  return out;
}

/**
 * Próximas citas libres (día + horario) a partir de hoy; sirve para que la IA
 * ofrezca opciones reales. Devuelve líneas como "hoy a las 10:00, 14:30" y
 * "mañana a las 09:00". Máximo `daysToScan` días a futuro.
 */
export function nextFreeSlots({
  schedule,
  busyByDate,
  durationMinutes,
  fromDate,
  daysToScan = 4,
  timesPerDay = 4,
}: {
  schedule: ScheduleConfig;
  busyByDate: Map<string, BusyAppointment[]>;
  durationMinutes: number;
  fromDate: string;
  daysToScan?: number;
  timesPerDay?: number;
}): Record<string, string[]> {
  const base = new Date(`${fromDate}T00:00:00`);
  const byDay: Record<string, string[]> = {};
  for (let i = 0; i < daysToScan; i++) {
    const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = `${pad(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!isWorkingDay(schedule, dateStr)) continue;
    const busy = busyByDate.get(dateStr) ?? [];
    const free = freeSlotsForDate({ schedule, busy, durationMinutes, dateStr, limit: timesPerDay });
    if (free.length) byDay[dateStr] = free;
    if (Object.keys(byDay).length >= 4) break;
  }
  return byDay;
}

/** Etiquetas legibles ("hoy", "mañana", "sábado 19") para el prompt de la IA. */
export function humanDayLabel(dateStr: string, now: { date: string }): string {
  if (dateStr === now.date) return "hoy";
  const today = new Date(`${now.date}T00:00:00`);
  const target = new Date(`${dateStr}T00:00:00`);
  const diff = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff === 1) return "mañana";
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${days[target.getDay()]}`;
}

/** "YYYY-MM-DD HH:MM:SS" (timestamp postgres) → "YYYY-MM-DD" */
export function dateFromDb(raw: string): string {
  return raw.slice(0, 10);
}