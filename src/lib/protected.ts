// Pago protegido piloto: custodia simple sin blockchain.
// - Comisión total 5%: 2.5% la compradora (paga total×1.025) + 2.5% la
//   tendera (recibe total×0.975). La pasarela (~3.5%) sale del neto.
// - Retención 48h con liberación automática (cron horario) + botón manual.
// - Tope $300.000 por pedido y solo tiendas voluntarias (protectedEnabled).
// - Desembolso semanal MANUAL en el piloto: el reporte lo genera
//   payoutReport() y el operador hace los Nequis y marca paid_out.
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { protectedPayments } from "../db/schema";

export const PROTECTED_BUYER_RATE = 0.025;
export const PROTECTED_SELLER_RATE = 0.025;
export const PROTECTED_MAX_TOTAL = 300_000;
export const PROTECTED_HOLD_MS = 48 * 60 * 60 * 1000;

export interface FeeSplit {
  /** Lo que paga la compradora (total + su mitad). */
  charge: number;
  /** Neto para la tendera en el desembolso. */
  sellerNet: number;
  buyerFee: number;
  sellerFee: number;
}

/** Matemática de la comisión 2.5/2.5 en COP enteros (siempre a favor). */
export function splitFees(total: number): FeeSplit {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const buyerFee = Math.round(t * PROTECTED_BUYER_RATE);
  const sellerFee = t - Math.floor(t * (1 - PROTECTED_SELLER_RATE));
  return {
    charge: t + buyerFee,
    sellerNet: t - sellerFee,
    buyerFee,
    sellerFee,
  };
}

export type ProtectedStatus =
  | "initiated"
  | "collected"
  | "held"
  | "released"
  | "paid_out"
  | "refunded"
  | "cancelled";

/** Transiciones legales del piloto (la plata solo avanza o se devuelve). */
const NEXT: Record<ProtectedStatus, ProtectedStatus[]> = {
  initiated: ["collected", "cancelled"],
  collected: ["held", "refunded", "cancelled"],
  held: ["released", "refunded"],
  released: ["paid_out", "refunded"],
  paid_out: [],
  refunded: [],
  cancelled: [],
};

export function canTransition(from: string, to: ProtectedStatus): boolean {
  return (NEXT[from as ProtectedStatus] ?? []).includes(to);
}

/**
 * Libera automáticamente lo retenido hace +48h. Idempotente; corre cada hora
 * desde el cron de expiración. Devuelve cuántos liberó.
 */
export async function releaseDueProtected(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - PROTECTED_HOLD_MS);
  const rows = await db
    .select({ id: protectedPayments.id })
    .from(protectedPayments)
    .where(
      and(
        eq(protectedPayments.status, "held"),
        lt(protectedPayments.createdAt, cutoff),
      ),
    );
  for (const row of rows) {
    await db
      .update(protectedPayments)
      .set({ status: "released", releasedAt: new Date(now) })
      .where(
        and(eq(protectedPayments.id, row.id), eq(protectedPayments.status, "held")),
      );
  }
  return rows.length;
}

/** Reporte semanal para los Nequis manuales: liberado pendiente de pago. */
export async function payoutReport() {
  return db
    .select({
      id: protectedPayments.id,
      orderId: protectedPayments.orderId,
      storeId: protectedPayments.storeId,
      sellerNet: protectedPayments.sellerNet,
      total: protectedPayments.total,
      createdAt: protectedPayments.createdAt,
    })
    .from(protectedPayments)
    .where(
      and(
        eq(protectedPayments.status, "released"),
        isNull(protectedPayments.paidOutAt),
      ),
    )
    .orderBy(protectedPayments.createdAt);
}

/** Suma pendiente por tienda (para el panel "Finanzas" de la tendera). */
export async function storeBalance(storeId: string) {
  const [row] = await db
    .select({
      pending: sql<string>`coalesce(sum(${protectedPayments.sellerNet}) filter (where ${protectedPayments.status} in ('held','released')), 0)::text`,
      paid: sql<string>`coalesce(sum(${protectedPayments.sellerNet}) filter (where ${protectedPayments.status} = 'paid_out'), 0)::text`,
    })
    .from(protectedPayments)
    .where(eq(protectedPayments.storeId, storeId));
  return {
    pending: Number(row?.pending ?? 0),
    paid: Number(row?.paid ?? 0),
  };
}
