import { describe, it, expect } from "vitest";
import { extractWhen } from "../src/lib/agent/when";
import { detectIntent } from "../src/lib/agent/intent";
import { findAllMatches, quantityBefore } from "../src/lib/agent/resolve";
import { planAgentReply } from "../src/lib/agent/plan";
import { norm } from "../src/lib/agent/text";

const TODAY = "2026-09-18"; // viernes

describe("when (fecha/hora)", () => {
  it("mañana a las 8:30", () => {
    const r = extractWhen("quiero una cita para mañana a las 8:30", TODAY);
    expect(r.date).toBe("2026-09-19");
    expect(r.time).toBe("08:30");
    expect(r.confidence).toBe(0.95);
  });

  it("pasado mañana en la tarde", () => {
    const r = extractWhen("pasado mañana en la tarde", TODAY);
    expect(r.date).toBe("2026-09-20");
    expect(r.fromMin).toBe(13 * 60);
    expect(r.toMin).toBe(18 * 60);
  });

  it("el lunes siguiente", () => {
    expect(extractWhen("reservame el lunes", TODAY).date).toBe("2026-09-21");
  });

  it("después de las 4", () => {
    expect(extractWhen("me sirve después de las 4", TODAY).fromMin).toBe(16 * 60);
  });

  it("en la mañana es franja, no fecha", () => {
    const r = extractWhen("¿qué tienes en la mañana?", TODAY);
    expect(r.date).toBeUndefined();
    expect(r.fromMin).toBe(8 * 60);
    expect(r.toMin).toBe(12 * 60);
  });

  it("mañana en la mañana combina ambos", () => {
    const r = extractWhen("mañana en la mañana", TODAY);
    expect(r.date).toBe("2026-09-19");
    expect(r.fromMin).toBe(8 * 60);
  });

  it("a las 3 pm → 15:00", () => {
    expect(extractWhen("a las 3 pm", TODAY).time).toBe("15:00");
  });

  it("sin señales temporales tiene confianza 0", () => {
    expect(extractWhen("qué precio tiene el corte", TODAY).confidence).toBe(0);
  });
});

describe("intent", () => {
  it("agendar una cita → reserva", () => {
    expect(detectIntent("quisiera agendar una cita para mi corte", { bookingEnabled: true, pedidosEnabled: false })).toBe("reserva");
  });

  it("reservame el servicio → reserva", () => {
    expect(detectIntent("reservame el corte de pelo", { bookingEnabled: true, pedidosEnabled: false })).toBe("reserva");
  });

  it("¿tienes cita mañana? → reserva (pregunta)", () => {
    expect(detectIntent("¿tienes cita mañana?", { bookingEnabled: true, pedidosEnabled: false })).toBe("reserva");
  });

  it("pregunta de disponibilidad de producto → otro", () => {
    expect(detectIntent("¿tienen hamburguesas?", { bookingEnabled: false, pedidosEnabled: true })).toBe("otro");
  });

  it("quiero 2 hamburguesas → pedido", () => {
    expect(detectIntent("quiero 2 hamburguesas", { bookingEnabled: false, pedidosEnabled: true })).toBe("pedido");
  });

  it("dame una hamburguesa (imperativo) → pedido", () => {
    expect(detectIntent("dame una hamburguesa", { bookingEnabled: false, pedidosEnabled: true })).toBe("pedido");
  });

  it("consulta de precio → otro", () => {
    expect(detectIntent("¿cuánto cuesta el vestido rojo?", { bookingEnabled: false, pedidosEnabled: true })).toBe("otro");
  });

  it("sin señales → otro", () => {
    expect(detectIntent("hola, que tal", { bookingEnabled: true, pedidosEnabled: true })).toBe("otro");
  });
});

describe("resolve", () => {
  it("encuentra ítems exactos y plurales", () => {
    const matches = findAllMatches("quiero 2 hamburguesas y una gaseosa", [{ name: "Hamburguesa" }, { name: "Gaseosa" }]);
    expect(matches.map((m) => m.name)).toEqual(["Hamburguesa", "Gaseosa"]);
  });

  it("respeta límites de palabra (pan ≠ pantalón)", () => {
    expect(findAllMatches("me gusta el pantalón", [{ name: "Pan" }])).toEqual([]);
  });

  it("extrae cantidad del número que precede", () => {
    const msg = norm("quiero 2 hamburguesas");
    const matches = findAllMatches(msg, [{ name: "Hamburguesa" }]);
    expect(quantityBefore(matches[0].index, msg)).toBe(2);
  });

  it("cantidad por defecto = 1", () => {
    const msg = norm("quiero una hamburguesa");
    const matches = findAllMatches(msg, [{ name: "Hamburguesa" }]);
    expect(quantityBefore(matches[0].index, msg)).toBe(1);
  });
});

const SERVICES = [{ name: "Corte de pelo" }, { name: "Manicure" }];
const PRODUCTS = [{ name: "Hamburguesa" }, { name: "Gaseosa" }];
const SLOTS: Record<string, string[]> = {
  "2026-09-18": ["14:00", "16:00"],
  "2026-09-19": ["08:00", "08:30", "09:00"],
};

function reply(message: string, bookingEnabled: boolean, pedidosEnabled: boolean) {
  return planAgentReply({
    lastMessage: message,
    bookingEnabled,
    pedidosEnabled,
    services: SERVICES,
    products: PRODUCTS,
    slotsByDay: SLOTS,
    today: TODAY,
  });
}

describe("plan (decisiones)", () => {
  it("reserva exacta disponible → booking_confirm", () => {
    const d = reply("reservame el corte de pelo para mañana a las 08:30", true, false);
    expect(d).toEqual({ type: "booking_confirm", serviceName: "Corte de pelo", date: "2026-09-19", time: "08:30" });
  });

  it("pregunta sobre disponibilidad → booking_offer, no confirma", () => {
    const d = reply("¿tienes el corte de pelo mañana a las 08:30?", true, false);
    expect(d.type).toBe("booking_offer");
    expect(d.serviceName).toBe("Corte de pelo");
  });

  it("día pedido sin hora → booking_offer de ese día", () => {
    const d = reply("agendame el corte para mañana", true, false);
    expect(d.type).toBe("booking_offer");
    if (d.type === "booking_offer") expect(d.slotsText).toContain("08:30");
  });

  it("hora que no existe en ningún día → booking_offer", () => {
    const d = reply("reservame el corte a las 11:00", true, false);
    expect(d.type).toBe("booking_offer");
  });

  it("reserva sin servicio claro → none (fallback LLM)", () => {
    expect(reply("quiero una cita", true, false).type).toBe("none");
  });

  it("pedido con cantidad → order", () => {
    const d = reply("quiero 2 hamburguesas y una gaseosa", false, true);
    expect(d).toEqual({
      type: "order",
      items: [
        { productName: "Hamburguesa", quantity: 2 },
        { productName: "Gaseosa", quantity: 1 },
      ],
    });
  });

  it("pedido sin producto del catálogo → none", () => {
    expect(reply("quiero un computador", false, true).type).toBe("none");
  });

  it("pregunta de disponibilidad de producto → none", () => {
    expect(reply("¿tienen hamburguesas?", false, true).type).toBe("none");
  });

  it("mensaje no transaccional → none", () => {
    expect(reply("hola, ¿qué me recomiendas?", true, true).type).toBe("none");
  });

  it("mensaje vacío → none", () => {
    expect(reply("", true, true).type).toBe("none");
  });
});