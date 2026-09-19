import { norm } from "./text";
import type { AgentIntent } from "./types";

const BOOKING_WORDS =
  /\b(cita|citas|reservar|reserva|reservame|apartar|apartame|agendar|agenda|turno|turnos|cupo|cupos|horario|horarios)\b/;

const BUY_IMPERATIVE =
  /\b(dame|traeme|traéme|llevame|pasame|pásame|mandame|encargame|apartame|reservame|pedime|hazme)\b/;

const BUY_SOFT =
  /\b(quiero|quisiera|necesito|me\s+llevo|llevo|compro|comprar|comprarte|pido|pedir|pedido|encargar)\b/;

const QUESTION_START =
  /^\s*(tienes|hay|queda|esta|está|existe|existen|habría|habra|tienen|tendrias|tendrías)\b/;

/**
 * Clasifica la intención transaccional del último mensaje. Solo dispara con
 * señales claras (palabras de reserva o de compra); todo lo dudoso cae en
 * "otro" para que la LLM acompañe la conversación.
 */
export function detectIntent(
  message: string,
  opts: { bookingEnabled: boolean; pedidosEnabled: boolean },
): AgentIntent {
  const raw = message.trim();
  const msg = norm(raw);
  if (!msg) return "otro";

  if (opts.bookingEnabled && BOOKING_WORDS.test(msg)) return "reserva";

  if (opts.pedidosEnabled) {
    if (BUY_IMPERATIVE.test(msg)) return "pedido";
    const question = /\?\s*$/.test(raw) || QUESTION_START.test(msg);
    if (!question && BUY_SOFT.test(msg)) return "pedido";
  }

  return "otro";
}