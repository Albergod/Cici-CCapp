// Lógica compartida de la respuesta del asistente (usada por el endpoint REST
// y por el WebSocket del chat). Centraliza: contexto (producto o servicio),
// slots libres de agenda para BELLEZA, generación de la respuesta de IA y la
// ejecución determinística de una reserva (RESERVAR) que emite la IA.
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, messages, products, storeServices, appointments, stores } from "../db/schema";
import { getIAStoreReply, buildInvoiceVersions, parseBookingCommand, parseOrderCommand } from "./ai";
import { createBooking } from "./appointments";
import { createPendingOrder, type PendingOrderItem } from "./orders";
import { planAgentReply } from "./agent/plan";
import {
  normalizeSchedule,
  nowInTimezone,
  nextFreeSlots,
  dateFromDb,
  groupFreeSlotsLines,
  type BusyAppointment,
} from "./booking";
import type { ScheduleConfig } from "../db/schema";
import { withOfferFlags } from "./offers";

export interface AssistantContext {
  conversation: {
    id: string;
    customerId: string;
    assertedProductId: string | null;
    assertedServiceId: string | null;
  };
  storeId: string;
}

export interface AssistantResult {
  content: string;
  waText: string | null;
  appointmentId: string | null;
  orderId: string | null;
}

/** Franjas libres de los próximos días en texto legible para el prompt de la IA. */
async function buildBookingSlots(storeId: string, schedule: ScheduleConfig, serviceDuration: number) {
  const now = nowInTimezone(schedule.timezone);
  const horizonEnd = new Date(`${now.date}T00:00:00`);
  horizonEnd.setDate(horizonEnd.getDate() + schedule.bookingHorizonDays);
  const horizonEndStr = `${horizonEnd.toISOString().slice(0, 10)} 23:59:59`;

  const rows = await db
    .select({
      appointmentDate: appointments.appointmentDate,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.storeId, storeId),
        ne(appointments.status, "cancelled"),
        gte(appointments.appointmentDate, `${now.date} 00:00:00`),
        lte(appointments.appointmentDate, horizonEndStr),
      ),
    );

  const busyByDate = new Map<string, BusyAppointment[]>();
  for (const r of rows) {
    const d = dateFromDb(String(r.appointmentDate));
    const list = busyByDate.get(d) ?? [];
    list.push({ startTime: r.startTime, endTime: r.endTime, status: r.status });
    busyByDate.set(d, list);
  }

  const byDay = nextFreeSlots({
    schedule,
    busyByDate,
    durationMinutes: serviceDuration,
    fromDate: now.date,
    daysToScan: 5,
    timesPerDay: 3,
  });

  const lines = groupFreeSlotsLines(byDay, now);
  return {
    byDay,
    text: lines.length ? lines.join("\n") : "No hay horarios disponibles para los próximos días.",
  };
}

/** Nombres de servicios con franjas: el contexto que la IA puede reservar. */

/**
 * Genera la respuesta del asistente para un mensaje de cliente. Devuelve ya la
 * versión final insertable (chat + waText) y, si se reservó una cita, el id de
 * la cita creada para que el frontend avise.
 */
export async function generateAssistantReply(
  ctx: AssistantContext,
  customerName?: string,
): Promise<AssistantResult> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, ctx.storeId),
    with: { products: true },
  });
  if (!store) return { content: "Lo sentimos, la tienda no está disponible.", waText: null, appointmentId: null, orderId: null };

  const isBeauty = store.businessType === "BELLEZA";
  const customer = customerName;

  // ── Productos disponibles para el catálogo del prompt ──────────────────
  const storeProducts = (store.products ?? []).map((p) => {
    const flagged = withOfferFlags({
      price: p.price,
      offerPrice: (p.offerPrice as string | null) ?? null,
      offerEndsAt: (p.offerEndsAt as Date | string | null) ?? null,
    });
    return {
      name: p.name,
      price: flagged.effectivePrice,
      description: p.description ?? undefined,
      stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null,
      attributes: p.attributes ?? undefined,
      onOffer: flagged.onOffer,
      discountPct: flagged.discountPct,
      offerEndsAt: flagged.offerEndsAt ?? undefined,
    };
  });
  // Fase 2: pedido automático (solo tiendas de productos con catálogo).
  const pedidosEnabled = !isBeauty && storeProducts.length > 0;

  const contextProduct = ctx.conversation.assertedProductId
    ? (store.products ?? []).find((p) => p.id === ctx.conversation.assertedProductId) ?? null
    : null;

  // ── Servicios y franjas (BELLEZA) ──────────────────────────────────────
  let services: { name: string; price: number; durationMinutes: number }[] = [];
  let bookingSlots = "";
  let slotsByDay: Record<string, string[]> = {};
  let contextServiceName: string | null = null;
  const schedule = normalizeSchedule(store.schedule);
  const today = nowInTimezone(schedule.timezone).date;
  if (isBeauty) {
    const serviceRows = await db.query.storeServices.findMany({
      where: eq(storeServices.storeId, store.id),
      orderBy: (sv, { asc: ascOp }) => [ascOp(sv.name)],
    });
    services = serviceRows.map((s) => ({ name: s.name, price: Number(s.price), durationMinutes: s.durationMinutes }));

    if (ctx.conversation.assertedServiceId) {
      contextServiceName = serviceRows.find((s) => s.id === ctx.conversation.assertedServiceId)?.name ?? null;
    }
    const fallbackDuration = serviceRows.find((s) => s.id === ctx.conversation.assertedServiceId)?.durationMinutes ?? services[0]?.durationMinutes ?? 60;
    if (services.length > 0) {
      const slots = await buildBookingSlots(store.id, schedule, fallbackDuration);
      slotsByDay = slots.byDay;
      bookingSlots = slots.text;
    }
  }

  const storeInfo = {
    name: store.name,
    plan: store.plan as "FREE" | "PRO" | "BUSINESS",
    prestigeActive: true,
    whatsapp: store.whatsapp ?? null,
    businessType: store.businessType as string,
  };

  const history = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, ctx.conversation.id))
    .orderBy(asc(messages.createdAt));

  // Cerebro determinístico (0 tokens): decide reservas y pedidos claros sin
  // llamar a la LLM. Solo transaccional; lo ambiguo sigue la ruta de la IA.
  const bookingEnabled = isBeauty && services.length > 0;
  const agentDecision =
    process.env.AGENT_DISABLED === "1"
      ? { type: "none" as const }
      : planAgentReply({
          lastMessage: history[history.length - 1]?.content ?? "",
          bookingEnabled,
          pedidosEnabled,
          services: services.map((s) => ({ name: s.name })),
          products: storeProducts.map((p) => ({ name: p.name })),
          slotsByDay,
          today,
        });

  if (agentDecision.type === "booking_offer") {
    return {
      content: `¡Claro que sí! El ${agentDecision.serviceName} está disponible: ${agentDecision.slotsText}. ¿Cuál te queda mejor? ☺️`,
      waText: null,
      appointmentId: null,
      orderId: null,
    };
  }

  const aiReply =
    agentDecision.type === "none" ? await getIAStoreReply({
      store: storeInfo,
      products: storeProducts,
      history,
      contextProduct: contextProduct ? { name: contextProduct.name, attributes: contextProduct.attributes ?? undefined } : null,
      customerName: customer,
      services: services.map((s) => ({ ...s })),
      bookingSlots,
      bookingEnabled,
      pedidosEnabled,
      contextService: contextServiceName,
    }) : "";

  // ¿Viene una orden de reserva? Ejecutarla SIEMPRE de forma determinística
  // (la IA nunca toca la DB).
  const booking =
    agentDecision.type === "booking_confirm"
      ? { serviceName: agentDecision.serviceName, date: agentDecision.date, time: agentDecision.time }
      : parseBookingCommand(aiReply);

  if (booking) {
    const service = services.find((s) => s.name === booking.serviceName);
    if (!service) {
      const suggestion = services.slice(0, 5).map((s) => s.name).join(", ");
      return {
        content: `No conozco ese servicio. Los disponibles son: ${suggestion}. ¿Cuál prefieres y en qué horario?`,
        waText: null,
        appointmentId: null,
        orderId: null,
      };
    }

    const serviceRow = await db.query.storeServices.findFirst({
      where: and(eq(storeServices.storeId, store.id), eq(storeServices.name, booking.serviceName)),
    });
    if (!serviceRow) {
      return {
        content: "No conozco ese servicio. Elige uno de los disponibles, por favor.",
        waText: null,
        appointmentId: null,
        orderId: null,
      };
    }

    const result = await createBooking({
      storeId: store.id,
      serviceId: serviceRow.id,
      customerId: ctx.conversation.customerId,
      storeBusinessType: store.businessType as string,
      dateStr: booking.date,
      startTime: booking.time,
    });

    if (result.ok) return confirmAppointment(store, booking, result, services);
    return conflictReply(result, store, bookingSlots);
  }

  // ¿Viene un pedido? Ejecutarlo SIEMPRE de forma determinística (la IA
  // nunca toca la DB).
  if (pedidosEnabled) {
    const orderReq =
      agentDecision.type === "order" ? { items: agentDecision.items } : parseOrderCommand(aiReply);
    if (orderReq) {
      const result = await createPendingOrder({
        storeId: store.id,
        customerId: ctx.conversation.customerId,
        items: orderReq.items,
      });
      if (!result.ok) {
        return {
          content: `😕 ${result.message}`,
          waText: null,
          appointmentId: null,
          orderId: null,
        };
      }
      return confirmOrder(result);
    }
  }

  // Respuesta normal de la IA (tal vez factura de un producto).
  const invoiceVersions = buildInvoiceVersions(aiReply);
  return {
    content: invoiceVersions ? invoiceVersions.chat : aiReply,
    waText: invoiceVersions ? invoiceVersions.wa : null,
    appointmentId: null,
    orderId: null,
  };
}

function confirmAppointment(
  store: { name: string },
  booking: { serviceName: string; date: string; time: string },
  result: { ok: true; appointment: { id: string; endTime: string } },
  services: { name: string; durationMinutes: number }[],
): AssistantResult {
  const service = services.find((s) => s.name === booking.serviceName);
  const durationLabel = service?.durationMinutes ? service.durationMinutes : "";
  return {
    content: `⭐ Cita reservada en ${store.name}\n\n*Servicio:* ${booking.serviceName}\n*Fecha:* ${booking.date}\n*Hora:* ${booking.time}${result.appointment.endTime ? ` - ${result.appointment.endTime}` : ""}\n\nEl comerciante la verá en su agenda y te coordinará si algo cambia.`,
    waText: `📅 Cita reservada:\n\n*Servicio:* ${booking.serviceName}\n*Fecha:* ${booking.date}\n*Hora:* ${booking.time}\n\nRevisa la agenda en la aplicación.`,
    appointmentId: result.appointment.id,
    orderId: null,
  };
}

function confirmOrder(
  order: { orderId: string; items: PendingOrderItem[]; total: number },
): AssistantResult {
  const money = (n: number) => `$${n.toLocaleString("es-CL")}`;
  const lines = order.items
    .map((it) => `• ${it.productName} x${it.quantity} = ${money(it.lineTotal)}`)
    .join("\n");
  return {
    content: `🛍️ Pedido anotado\n\n${lines}\n*Total:* ${money(order.total)}\n\nEl comerciante lo confirmará y te escribirá para coordinar la entrega.`,
    waText: `🛍️ Nuevo pedido por confirmar:\n\n${lines}\n*Total:* ${money(order.total)}\n\nRevísalo en "Pedidos" de tu panel.`,
    appointmentId: null,
    orderId: order.orderId,
  };
}

function conflictReply(
  result: { code: string; message: string },
  store: { name: string },
  bookingSlots: string,
): AssistantResult {
  const map: Record<string, string> = {
    closed_day: "ese día no abrimos",
    closed_hours: "esa hora está fuera de nuestro horario",
    lunch: "ese horario es nuestro almuerzo",
    past: "esa hora ya pasó",
    beyond_horizon: "ese día está fuera del horizonte de reservas",
    busy_slot: "esa hora ya está tomada",
    invalid_time: "esa hora no es válida",
  };
  const reason = map[result.code] ?? result.message;
  return {
    content: `😕 No pudimos agendar: ${reason}.\n\nHorarios libres que te propongo:\n${bookingSlots}\n\n¿Quieres reservar alguno?`,
    waText: null,
    appointmentId: null,
    orderId: null,
  };
}