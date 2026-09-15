import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  timeToMinutes,
  minutesToTime,
  validateSlot,
  freeSlotsForDate,
  nextFreeSlots,
  slotConflicts,
  nowInTimezone,
  dateFromDb,
} from "../src/lib/booking";

const sched = normalizeSchedule({});
const busyCita = [{ startTime: "10:00", endTime: "11:00", status: "confirmed" }];

describe("helpers", () => {
  it("parsea y formatea horas", () => {
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("21:00")).toBe(1260);
    expect(timeToMinutes("25:00")).toBeNull();
    expect(minutesToTime(480)).toBe("08:00");
    expect(minutesToTime(1259)).toBe("20:59");
  });

  it("por defecto: 8:00-21:00, almuerzo 12-13, lun-sáb, Bogotá", () => {
    const s = normalizeSchedule(undefined);
    expect(s.openTime).toBe("08:00");
    expect(s.lunchStart).toBe("12:00");
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.timezone).toBe("America/Bogota");
    expect(DEFAULT_SCHEDULE.bookingHorizonDays).toBe(30);
  });

  it("fecha desde timestamp postgres", () => {
    expect(dateFromDb("2026-09-20 10:30:00")).toBe("2026-09-20");
  });

  it("slotConflicts detecta solapamientos", () => {
    expect(slotConflicts(busyCita, 600, 660)).toBe(true); // igual (10:00-11:00)
    expect(slotConflicts(busyCita, 540, 660)).toBe(true); // envuelve
    expect(slotConflicts(busyCita, 630, 720)).toBe(true); // empieza dentro
    expect(slotConflicts(busyCita, 660, 720)).toBe(false); // justo después
    expect(slotConflicts([{ startTime: "10:00", endTime: "11:00", status: "cancelled" }], 600, 660)).toBe(false); // cancelada no bloquea
  });

  it("nowInTimezone devuelve fecha + minutos", () => {
    const now = nowInTimezone("America/Bogota");
    expect(now.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now.minutes).toBeGreaterThanOrEqual(0);
    expect(now.minutes).toBeLessThan(1440);
  });
});

describe("validateSlot", () => {
  const now = { date: "2026-09-14", minutes: 540 }; // lunes 09:00 local

  it("acepta un slot válido", () => {
    const r = validateSlot({
      schedule: sched,
      busy: busyCita,
      dateStr: "2026-09-14",
      startTime: "14:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza slot ocupado", () => {
    const r = validateSlot({
      schedule: sched,
      busy: busyCita,
      dateStr: "2026-09-14",
      startTime: "10:30",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("busy_slot");
  });

  it("rechaza almuerzo", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: "2026-09-14",
      startTime: "12:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("lunch");
  });

  it("rechaza día no laborable (domingo)", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: "2026-09-20", // domingo
      startTime: "10:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("closed_day");
  });

  it("rechaza hora pasada de hoy", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: now.date,
      startTime: "08:30",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("past");
  });

  it("rechaza fuera de horario", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: "2026-09-14",
      startTime: "22:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("closed_hours");
  });

  it("rechaza más allá del horizonte", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: "2026-10-20",
      startTime: "10:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("beyond_horizon");
  });

  it("acepta futuro dentro del horizonte", () => {
    const r = validateSlot({
      schedule: sched,
      busy: [],
      dateStr: "2026-09-16",
      startTime: "10:00",
      durationMinutes: 60,
      now,
    });
    expect(r.ok).toBe(true);
  });
});

describe("freeSlotsForDate / nextFreeSlots", () => {
  const now = { date: "2026-09-14", minutes: 0 };

  it("lista franjas libres sin solapar citas y salteando almuerzo", () => {
    const free = freeSlotsForDate({
      schedule: sched,
      busy: busyCita,
      durationMinutes: 60,
      dateStr: "2026-09-14",
      limit: 20,
    });
    // Paso de 30': 08:00, 08:30, 09:00 (09:30 y 10:00 tocan la cita 10-11), 11:00 (12 es almuerzo), 13:00
    expect(free.slice(0, 5)).toEqual(["08:00", "08:30", "09:00", "11:00", "13:00"]);
  });

  it("comienza a las :00/:30", () => {
    const free = freeSlotsForDate({
      schedule: sched,
      busy: [],
      durationMinutes: 60,
      dateStr: "2026-09-14",
      limit: 3,
    });
    expect(free).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("nextFreeSlots agrupa por día salteando domingos", () => {
    const byDay = nextFreeSlots({
      schedule: sched,
      busyByDate: new Map(),
      durationMinutes: 60,
      fromDate: "2026-09-13", // domingo
      daysToScan: 3,
      timesPerDay: 2,
    });
    expect(byDay["2026-09-14"]).toEqual(["08:00", "08:30"]); // lunes
    expect(byDay["2026-09-13"]).toBeUndefined(); // domingo saltado
    expect(byDay["2026-09-15"]).toEqual(["08:00", "08:30"]); // martes
  });
});