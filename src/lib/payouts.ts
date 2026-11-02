// Cici Payments: motor de liquidaciones.
//
// Flujo: el ledger marca saldos AVAILABLE cuando se libera el pago protegido.
// Solicitar una liquidación bloquea esos movimientos (IN_TRANSFER) y crea un
// payout PREPARED. Solo al confirmar el desembolso se marcan PAID_OUT SIEMPRE
// con la confirmación del operador/proveedor, nunca por la respuesta del
// frontend. Un fallo devuelve los movimientos a AVAILABLE sin perder dinero.
import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  ledgerEntries,
  merchantBankAccounts,
  payouts,
} from "../db/schema";

export type PayoutStatus =
  | "PREPARED"
  | "SENT"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

export type PayoutResult =
  | { ok: true; payout: typeof payouts.$inferSelect; alreadyExisted?: boolean }
  | { ok: false; status: number; code: string; message: string };

function entriesKey(storeId: string, ids: string[]): string {
  const digest = crypto
    .createHash("sha256")
    .update([...ids].sort().join(","), "utf8")
    .digest("hex");
  return `payout:${storeId}:${digest}`;
}

/**
 * Crea una liquidación con TODO el saldo disponible del comerciante.
 *
 * Concurrencia: se bloquean las filas AVAILABLE con FOR UPDATE; si dos
 * solicitudes corren a la vez, la segunda ya no encuentra filas disponibles.
 * Idempotencia: la clave se deriva del conjunto exacto de movimientos, así un
 * reintento con el mismo lote no crea una segunda transferencia.
 */
export async function requestPayout(
  storeId: string,
  createdBy: string | null,
): Promise<PayoutResult> {
  return db.transaction(async (trx) => {
    const [account] = await trx
      .select()
      .from(merchantBankAccounts)
      .where(
        and(
          eq(merchantBankAccounts.storeId, storeId),
          eq(merchantBankAccounts.isDefault, true),
        ),
      )
      .limit(1);
    if (!account) {
      return {
        ok: false as const,
        status: 409,
        code: "bank_account_required",
        message: "Registra una cuenta bancaria antes de solicitar una liquidación.",
      };
    }
    if (account.verificationStatus === "REJECTED") {
      return {
        ok: false as const,
        status: 409,
        code: "bank_account_rejected",
        message: "La cuenta bancaria fue rechazada. Registra una nueva.",
      };
    }

    const entries = await trx
      .select({ id: ledgerEntries.id, amount: ledgerEntries.amount })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.storeId, storeId),
          eq(ledgerEntries.status, "AVAILABLE"),
        ),
      )
      .for("update");

    if (!entries.length) {
      return {
        ok: false as const,
        status: 409,
        code: "no_balance",
        message: "No tienes saldo disponible para liquidar.",
      };
    }

    const amount = entries.reduce((acc, e) => acc + Number(e.amount), 0);
    if (!(amount > 0)) {
      return {
        ok: false as const,
        status: 409,
        code: "no_balance",
        message: "El saldo disponible no es positivo.",
      };
    }

    const baseKey = entriesKey(
      storeId,
      entries.map((e) => e.id),
    );

    // Un intento previo solo se reutiliza si sigue vivo. Si falló, sus
    // movimientos volvieron a AVAILABLE y el reintento debe crear un payout
    // nuevo: reutilizar el FAILED dejaría el saldo sin bloquear y sin pagar.
    const prior = await trx
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.storeId, storeId),
          sql`(${payouts.idempotencyKey} = ${baseKey} OR ${payouts.idempotencyKey} LIKE ${`${baseKey}:%`})`,
        ),
      );
    const live = prior.find((p) => p.status !== "FAILED" && p.status !== "CANCELLED");
    if (live) {
      return { ok: true as const, payout: live, alreadyExisted: true };
    }
    const idempotencyKey = prior.length ? `${baseKey}:${prior.length + 1}` : baseKey;

    const [payout] = await trx
      .insert(payouts)
      .values({
        storeId,
        bankAccountId: account.id,
        amount: String(Math.round(amount * 100) / 100),
        provider: "MANUAL",
        status: "PREPARED",
        idempotencyKey,
        createdBy: createdBy ?? null,
      })
      .returning();

    await trx
      .update(ledgerEntries)
      .set({ status: "IN_TRANSFER", payoutId: payout.id, updatedAt: new Date() })
      .where(
        and(
          eq(ledgerEntries.storeId, storeId),
          eq(ledgerEntries.status, "AVAILABLE"),
          inArray(
            ledgerEntries.id,
            entries.map((e) => e.id),
          ),
        ),
      );

    return { ok: true as const, payout };
  });
}

/**
 * Confirma que el dinero llegó al comerciante. Solo aquí se marca PAID_OUT.
 * Idempotente: repetir la confirmación devuelve el mismo payout.
 */
export async function confirmPayout(
  payoutId: string,
  storeId: string,
  providerPayoutId?: string | null,
): Promise<PayoutResult> {
  return db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), eq(payouts.storeId, storeId)))
      .limit(1)
      .for("update");
    if (!row) {
      return { ok: false as const, status: 404, code: "not_found", message: "Liquidación no encontrada." };
    }
    if (row.status === "SUCCESS") {
      return { ok: true as const, payout: row, alreadyExisted: true };
    }
    if (row.status === "FAILED" || row.status === "CANCELLED") {
      return {
        ok: false as const,
        status: 409,
        code: "invalid_status",
        message: `No se puede confirmar una liquidación ${row.status}.`,
      };
    }

    const [updated] = await trx
      .update(payouts)
      .set({
        status: "SUCCESS",
        providerPayoutId: providerPayoutId ?? row.providerPayoutId,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payouts.id, row.id), inArray(payouts.status, ["PREPARED", "SENT", "PROCESSING"])))
      .returning();
    if (!updated) {
      return {
        ok: false as const,
        status: 409,
        code: "invalid_status",
        message: "La liquidación cambió de estado. Vuelve a consultarla.",
      };
    }

    await trx
      .update(ledgerEntries)
      .set({ status: "PAID_OUT", updatedAt: new Date() })
      .where(
        and(
          eq(ledgerEntries.payoutId, row.id),
          eq(ledgerEntries.status, "IN_TRANSFER"),
        ),
      );

    return { ok: true as const, payout: updated };
  });
}

/**
 * Marca una liquidación como fallida y devuelve los movimientos a AVAILABLE.
 * El dinero no se pierde ni se duplica: el siguiente intento crea un nuevo
 * payout con los mismos movimientos.
 */
export async function failPayout(
  payoutId: string,
  storeId: string,
  reason: string,
): Promise<PayoutResult> {
  return db.transaction(async (trx) => {
    const [row] = await trx
      .select()
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), eq(payouts.storeId, storeId)))
      .limit(1)
      .for("update");
    if (!row) {
      return { ok: false as const, status: 404, code: "not_found", message: "Liquidación no encontrada." };
    }
    if (row.status === "SUCCESS") {
      return {
        ok: false as const,
        status: 409,
        code: "already_paid",
        message: "La liquidación ya fue pagada; no se puede revertir sin un ajuste manual.",
      };
    }
    if (row.status === "FAILED" || row.status === "CANCELLED") {
      return { ok: true as const, payout: row, alreadyExisted: true };
    }

    const [updated] = await trx
      .update(payouts)
      .set({
        status: "FAILED",
        failureReason: reason.slice(0, 300),
        updatedAt: new Date(),
      })
      .where(and(eq(payouts.id, row.id), inArray(payouts.status, ["PREPARED", "SENT", "PROCESSING"])))
      .returning();

    await trx
      .update(ledgerEntries)
      .set({ status: "AVAILABLE", payoutId: null, updatedAt: new Date() })
      .where(
        and(
          eq(ledgerEntries.payoutId, row.id),
          eq(ledgerEntries.status, "IN_TRANSFER"),
        ),
      );

    return { ok: true as const, payout: updated };
  });
}

export async function listPayouts(storeId: string, limit = 50) {
  return db
    .select()
    .from(payouts)
    .where(eq(payouts.storeId, storeId))
    .orderBy(sql`${payouts.createdAt} DESC`)
    .limit(limit);
}
