// Cici Payments: ledger financiero inmutable.
//
// Reglas:
//  - Cada hecho contable se registra con una `idempotency_key` única. Los
//    webhooks duplicados o los reintentos no duplican movimientos.
//  - Los movimientos NUNCA se editan ni se borran. Las correcciones son
//    movimientos compensatorios (ADJUSTMENT/REVERSED).
//  - El saldo se reconstruye sumando movimientos, no con un campo mutable.
//
// Convención de signo (relativa al comerciante):
//   SALE        +total      (valor de la venta)
//   COMMISSION  −sellerFee  (comisión de Cici)
//   => neto     sellerNet
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ledgerEntries, payments, paymentMethodEnum, paymentRecordStatusEnum } from "../db/schema";

// El executor es `db` o una transacción de drizzle. Se tipa de forma laxa para
// aceptar ambos sin duplicar firmas (la transacción expone insert/update/select).
type Executor = typeof db | any;

export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type PaymentRecordStatus = (typeof paymentRecordStatusEnum.enumValues)[number];

export interface SaleLedgerInput {
  providerTransactionId: string;
  reference: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentRecordStatus;
  amount: number;
  total: number;
  sellerFee: number;
  sellerNet: number;
  orderId?: string | null;
  storeId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  provider?: string;
  currency?: string;
}

export interface LedgerBalance {
  /** Ventas aprobadas aún retenidas (no liquidables). */
  pending: number;
  /** Saldo liquidable. */
  available: number;
  /** Comprometido en una liquidación enviada/procesando. */
  inTransfer: number;
  /** Ya desembolsado. */
  paidOut: number;
  /** Anulado por devolución/compensación. */
  reversed: number;
  /** Suma neta de todos los movimientos (incluye estados no liberados). */
  total: number;
}

const money = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

/** Busca o crea el pago normalizado. Idempotente por (provider, txId). */
export async function ensurePayment(
  exec: Executor,
  data: Omit<SaleLedgerInput, "total" | "sellerFee" | "sellerNet"> & { total?: number },
): Promise<string> {
  const provider = data.provider ?? "WOMPI";
  const amount = money(data.amount);
  const [inserted] = await exec
    .insert(payments)
    .values({
      orderId: data.orderId ?? null,
      storeId: data.storeId,
      customerId: data.customerId ?? null,
      customerEmail: data.customerEmail ?? null,
      provider,
      providerTransactionId: data.providerTransactionId,
      reference: data.reference,
      paymentMethod: data.paymentMethod,
      amount,
      currency: data.currency ?? "COP",
      status: data.paymentStatus,
      idempotencyKey: `payment:${provider}:${data.providerTransactionId}`,
    })
    .onConflictDoNothing()
    .returning({ id: payments.id });

  if (inserted) return inserted.id as string;

  const [existing] = await exec
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        eq(payments.providerTransactionId, data.providerTransactionId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("No se pudo registrar el pago");
  return existing.id as string;
}

/**
 * Registra la venta y la comisión de Cici para un pago aprobado. Idempotente:
 * si los movimientos ya existen, no se duplican. Se ejecuta DENTRO de la misma
 * transacción que cambia el estado del pago protegido.
 */
export async function recordSaleLedger(
  exec: Executor,
  input: SaleLedgerInput,
): Promise<{ paymentId: string }> {
  const paymentId = await ensurePayment(exec, input);

  await exec
    .insert(ledgerEntries)
    .values([
      {
        paymentId,
        orderId: input.orderId ?? null,
        storeId: input.storeId,
        entryType: "SALE",
        amount: money(input.total),
        currency: input.currency ?? "COP",
        status: "PENDING",
        description: "Venta aprobada (retenida hasta liberación)",
        idempotencyKey: `ledger:${paymentId}:sale`,
      },
      {
        paymentId,
        orderId: input.orderId ?? null,
        storeId: input.storeId,
        entryType: "COMMISSION",
        // Débito al comerciante por la comisión de la plataforma.
        amount: money(-input.sellerFee),
        currency: input.currency ?? "COP",
        status: "PENDING",
        description: "Comisión de Cici",
        idempotencyKey: `ledger:${paymentId}:commission`,
      },
    ])
    .onConflictDoNothing();

  await exec
    .update(payments)
    .set({ status: "APPROVED", updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  return { paymentId };
}

/** Libera los movimientos retenidos de un pago (PENDING → AVAILABLE). */
export async function markPaymentAvailable(
  exec: Executor,
  paymentId: string,
): Promise<number> {
  const rows = await exec
    .update(ledgerEntries)
    .set({ status: "AVAILABLE", updatedAt: new Date() })
    .where(
      and(
        eq(ledgerEntries.paymentId, paymentId),
        eq(ledgerEntries.status, "PENDING"),
      ),
    )
    .returning({ id: ledgerEntries.id });
  return rows.length;
}

/**
 * Anula los movimientos de un pago por devolución. Solo se permite si el
 * dinero todavía no salió (PENDING o AVAILABLE). Si está IN_TRANSFER o
 * PAID_OUT, la devolución requiere un proceso compensatorio manual.
 */
export async function reversePaymentLedger(
  exec: Executor,
  paymentId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const [busy] = await exec
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.paymentId, paymentId),
        inArray(ledgerEntries.status, ["IN_TRANSFER", "PAID_OUT"]),
      ),
    )
    .limit(1);
  if (busy) return { ok: false, reason: "already_disbursing" };

  await exec
    .update(ledgerEntries)
    .set({ status: "REVERSED", updatedAt: new Date() })
    .where(
      and(
        eq(ledgerEntries.paymentId, paymentId),
        inArray(ledgerEntries.status, ["PENDING", "AVAILABLE"]),
      ),
    );
  await exec
    .update(payments)
    .set({ status: "VOIDED", updatedAt: new Date() })
    .where(eq(payments.id, paymentId));
  return { ok: true };
}

/** Marca los movimientos de un pago como pagados (desembolso confirmado). */
export async function markPaymentPaidOut(
  exec: Executor,
  paymentId: string,
  payoutId: string,
): Promise<number> {
  // Solo se pagan movimientos disponibles. Un saldo IN_TRANSFER pertenece a
  // una liquidación y se confirma únicamente por el motor de payouts; así el
  // desembolso manual legacy no puede pagar dos veces el mismo dinero.
  const rows = await exec
    .update(ledgerEntries)
    .set({ status: "PAID_OUT", payoutId, updatedAt: new Date() })
    .where(
      and(
        eq(ledgerEntries.paymentId, paymentId),
        eq(ledgerEntries.status, "AVAILABLE"),
      ),
    )
    .returning({ id: ledgerEntries.id });
  return rows.length;
}

/** Saldo del comerciante reconstruido desde el ledger. */
export async function balanceForStore(storeId: string): Promise<LedgerBalance> {
  const rows = await db
    .select({
      status: ledgerEntries.status,
      sum: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.storeId, storeId))
    .groupBy(ledgerEntries.status);

  const byStatus = new Map(rows.map((r) => [r.status, Number(r.sum)]));
  const pending = byStatus.get("PENDING") ?? 0;
  const available = byStatus.get("AVAILABLE") ?? 0;
  const inTransfer = byStatus.get("IN_TRANSFER") ?? 0;
  const paidOut = byStatus.get("PAID_OUT") ?? 0;
  const reversed = byStatus.get("REVERSED") ?? 0;
  return {
    pending,
    available,
    inTransfer,
    paidOut,
    reversed,
    total: pending + available + inTransfer + paidOut + reversed,
  };
}

/** Movimientos de un pago (para auditoría y pruebas). */
export async function entriesForPayment(paymentId: string) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.paymentId, paymentId))
    .orderBy(ledgerEntries.entryType);
}
