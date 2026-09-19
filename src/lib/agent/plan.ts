import { humanDayLabel } from "../booking";
import { norm } from "./text";
import { detectIntent } from "./intent";
import { extractWhen } from "./when";
import { findAllMatches, quantityBefore } from "./resolve";
import type { AgentDecision, WhenResult } from "./types";

export interface AgentInput {
  lastMessage: string;
  bookingEnabled: boolean;
  pedidosEnabled: boolean;
  services: { name: string }[];
  products: { name: string }[];
  slotsByDay: Record<string, string[]>;
  today: string; // YYYY-MM-DD
}

/**
 * Cerebro transaccional determinístico (0 tokens). Solo decide reservas y
 * pedidos claramente expresados; todo lo demás queda para la LLM. Nunca toca
 * la DB: devuelve una decisión que assistant.ts ejecuta de forma segura.
 */
export function planAgentReply(input: AgentInput): AgentDecision {
  const raw = input.lastMessage.trim();
  if (!raw) return { type: "none" };
  const msg = norm(raw);

  const intent = detectIntent(raw, {
    bookingEnabled: input.bookingEnabled,
    pedidosEnabled: input.pedidosEnabled,
  });

  const svc = findAllMatches(msg, input.services)[0];
  const when = extractWhen(raw, input.today);

  if (input.bookingEnabled) {
    // Reserva con señales claras: palabra de reserva, o servicio mencionado
    // con una fecha/hora concreta (aunque falte la palabra "cita").
    const wantsBooking = intent === "reserva" || (svc !== undefined && when.confidence >= 0.55);
    if (wantsBooking) {
      if (!svc) return { type: "none" }; // no arriesgar un servicio incorrecto
      return bookingDecision(svc.name, when, input, raw);
    }
  }

  if (intent === "pedido" && input.pedidosEnabled) {
    const matches = findAllMatches(msg, input.products);
    if (!matches.length) return { type: "none" };
    const items = matches.map((m) => ({
      productName: m.name,
      quantity: quantityBefore(m.index, msg),
    }));
    return { type: "order", items };
  }

  return { type: "none" };
}

function bookingDecision(
  serviceName: string,
  when: WhenResult,
  input: AgentInput,
  raw: string,
): AgentDecision {
  const days = Object.keys(input.slotsByDay);
  if (!days.length) return { type: "none" };

  const question =
    /\?\s*$/.test(raw.trim()) ||
    /^\s*(tienes|hay|queda|esta|está|existe|habría|habra|tienen|cuando|cual|qué|que)\b/.test(norm(raw));

  const offer = (onlyDay?: string): AgentDecision => ({
    type: "booking_offer",
    serviceName,
    slotsText: buildSlotsText(input.slotsByDay, input.today, onlyDay),
  });

  if (when.confidence < 0.5) return offer();

  const times = when.date ? input.slotsByDay[when.date] : undefined;

  if (when.date && when.time) {
    if (times?.includes(when.time)) {
      if (question) return offer(when.date);
      return { type: "booking_confirm", serviceName, date: when.date, time: when.time };
    }
    if (times?.length) return offer(when.date);
    return offer();
  }

  if (when.date) {
    if (times?.length) return offer(when.date);
    return offer();
  }

  if (when.time) {
    const day = firstDayWithExactTime(input.slotsByDay, when.time);
    if (day) {
      if (question) return offer(day);
      return { type: "booking_confirm", serviceName, date: day, time: when.time };
    }
    return offer();
  }

  if (when.fromMin !== undefined || when.toMin !== undefined) {
    const day = firstDayInRange(input.slotsByDay, when.fromMin, when.toMin);
    if (day) return offer(day);
    return offer();
  }

  return offer();
}

function slotMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function firstDayWithExactTime(byDay: Record<string, string[]>, time: string): string | null {
  for (const d of Object.keys(byDay).sort()) {
    if (byDay[d].includes(time)) return d;
  }
  return null;
}

function firstDayInRange(
  byDay: Record<string, string[]>,
  fromMin: number | undefined,
  toMin: number | undefined,
): string | null {
  const lo = fromMin ?? 0;
  const hi = toMin ?? 24 * 60;
  for (const d of Object.keys(byDay).sort()) {
    if (byDay[d].some((t) => {
      const m = slotMin(t);
      return m >= lo && m <= hi;
    })) return d;
  }
  return null;
}

function buildSlotsText(
  byDay: Record<string, string[]>,
  today: string,
  onlyDay?: string,
): string {
  const subset = onlyDay ? { [onlyDay]: byDay[onlyDay] } : byDay;
  const groups = new Map<string, string[]>();
  for (const [d, ts] of Object.entries(subset)) {
    const key = ts.join("::");
    const arr = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }
  const lines = [...groups.values()].map((dates) => {
    const labels = [...dates].sort().map((d) => humanDayLabel(d, { date: today }));
    const joined = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}` : labels[0];
    return `${joined}: ${subset[dates[0]].join(", ")}`;
  });
  return lines.join(" · ");
}