export type AgentIntent = "reserva" | "pedido" | "otro";

export type AgentDecision =
  | { type: "none" }
  | { type: "booking_offer"; serviceName: string; slotsText: string }
  | { type: "booking_confirm"; serviceName: string; date: string; time: string }
  | { type: "order"; items: { productName: string; quantity: number }[] };

export interface WhenResult {
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  fromMin?: number; // minuto de la hora mínima (desde)
  toMin?: number; // minuto de la hora máxima (hasta)
  confidence: number; // 0..1
}