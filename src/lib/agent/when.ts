import { norm } from "./text";
import type { WhenResult } from "./types";

const DAY_NUMBER: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

function nextWeekday(today: string, weekday: number): string {
  const t = new Date(`${today}T12:00:00`);
  let delta = (weekday - t.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(today, delta);
}

function hour24(h: number, meridian?: string): number {
  if (meridian === "pm" && h < 12) return h + 12;
  if (meridian === "am" && h === 12) return 0;
  // Horas 1-6 sin meridiano = tarde (la jornada de servicios abre a las 8:00)
  if (!meridian && h >= 1 && h <= 6) return h + 12;
  return h;
}

function makeTime(h: number, mi: number, meridian?: string): string | undefined {
  const hour = hour24(h, meridian);
  if (hour > 23 || mi > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/**
 * Extrae cuándo quiere el cliente: fecha (YYYY-MM-DD), hora exacta (HH:MM) o
 * una franja (desde/hasta en minutos). Nunca lanza: lo que no reconoce, no lo
 * inventa; indica su certeza en `confidence`.
 */
export function extractWhen(message: string, today: string): WhenResult {
  const raw = message.trim();
  const msg = norm(raw);
  const r: WhenResult = { confidence: 0 };

  // ── Fecha ──
  const morningPhrase = /\b(?:en|por)\s+la\s+manana\b/.test(msg);
  // "mañana" suelto = día siguiente; "en la mañana" = franja de mañana.
  const tmp = morningPhrase ? msg.split("en la manana").join("").split("por la manana").join("") : msg;
  const standaloneTomorrow = /\bmanana\b/.test(tmp);
  if (/\bpasado\s+manana\b/.test(msg)) {
    r.date = addDays(today, 2);
  } else if (standaloneTomorrow) {
    r.date = addDays(today, 1);
  } else if (/\bhoy\b/.test(msg)) {
    r.date = today;
  } else {
    const wd = /\bel\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(msg);
    if (wd) {
      r.date = nextWeekday(today, DAY_NUMBER[wd[1]]);
    } else {
      const dm = /\bel\s+(?:dia\s+)?(\d{1,2}(?:\/\d{1,2})?)\b/.exec(msg);
      if (dm) {
        const [ddS, mmS] = dm[1].split("/");
        const dd = Number(ddS);
        if (dd >= 1 && dd <= 31) {
          const tgt = new Date(`${today}T12:00:00`);
          tgt.setDate(dd);
          if (mmS) tgt.setMonth(Number(mmS) - 1);
          const startOfToday = new Date(`${today}T00:00:00`);
          if (tgt.getTime() < startOfToday.getTime()) tgt.setMonth(tgt.getMonth() + 1);
          r.date = fmt(tgt);
        }
      }
    }
  }

  // ── Franja (en la mañana / tarde / noche) ──
  if (/\b(?:en|por)\s+la\s+manana\b/.test(msg)) {
    r.fromMin = 8 * 60;
    r.toMin = 12 * 60;
  } else if (/\b(?:en|por)\s+la\s+tarde\b/.test(msg)) {
    r.fromMin = 13 * 60;
    r.toMin = 18 * 60;
  } else if (/\b(?:en|por)\s+la\s+noche\b/.test(msg)) {
    r.fromMin = 18 * 60;
    r.toMin = 21 * 60;
  }

  // ── "después de las 4" / "antes de las 4" ──
  const dep = /\bdespues\s+de\s+las?\s+(\d{1,2})(?::(\d{2}))?\b/.exec(msg);
  if (dep) {
    const t = makeTime(Number(dep[1]), dep[2] ? Number(dep[2]) : 0);
    if (t) {
      const [h, mi] = t.split(":").map(Number);
      r.fromMin = h * 60 + mi;
    }
  } else {
    const ant = /\bantes\s+de\s+las?\s+(\d{1,2})(?::(\d{2}))?\b/.exec(msg);
    if (ant) {
      const t = makeTime(Number(ant[1]), ant[2] ? Number(ant[2]) : 0);
      if (t) {
        const [h, mi] = t.split(":").map(Number);
        r.toMin = h * 60 + mi;
      }
    }
  }

  // ── Hora exacta ──
  const m1 = /\ba\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(msg);
  if (m1) {
    r.time = makeTime(Number(m1[1]), m1[2] ? Number(m1[2]) : 0, m1[3]);
  } else {
    const m2 = /\b(\d{1,2}):(\d{2})\b/.exec(msg);
    if (m2) r.time = makeTime(Number(m2[1]), Number(m2[2]));
    else {
      const m3 = /\b(\d{1,2})\s?(am|pm)\b/.exec(msg);
      if (m3) r.time = makeTime(Number(m3[1]), 0, m3[2]);
    }
  }

  // ── Certeza ──
  if (r.date && r.time) r.confidence = 0.95;
  else if (r.date && (r.fromMin !== undefined || r.toMin !== undefined)) r.confidence = 0.8;
  else if (r.date) r.confidence = 0.6;
  else if (r.time || r.fromMin !== undefined || r.toMin !== undefined) r.confidence = 0.55;

  return r;
}