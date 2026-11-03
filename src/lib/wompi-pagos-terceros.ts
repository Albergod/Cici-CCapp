// Cici Payments: Wompi Pagos a Terceros (desembolso automático).
//
// Documentación: https://docs.wompi.co/docs/colombia/introduccion-pagos-a-terceros/
//
// Variables de entorno:
//   WOMPI_PAGOS_A_TERCEROS_BASE_URL   → https://api.sandbox.payouts.wompi.co/v1 (sandbox)
//   WOMPI_PAGOS_A_TERCEROS_USER_PRINCIPAL_ID  → user-principal-id header
//   WOMPI_PAGOS_A_TERCEROS_API_KEY    → x-api-key header
//
// Seguridad:
//  - El número de cuenta se DESCIFRA solo aquí, en el servidor, para enviarlo a Wompi.
//  - Nunca se devuelve el número completo por la API.
//  - Si Wompi rechaza o falla, NO se toca el dinero: el payout queda FAILED y el
//    saldo vuelve a AVAILABLE.

import { decryptSecret } from "./crypto";
import { db } from "../db/client";
import { merchantBankAccounts } from "../db/schema";
import { eq, and } from "drizzle-orm";

const DEFAULT_BASE_URL = "https://api.sandbox.payouts.wompi.co/v1";

export const WOMPI_PAGOS_A_TERCEROS_BASE_URL =
  process.env.WOMPI_PAGOS_A_TERCEROS_BASE_URL ?? DEFAULT_BASE_URL;

export function wompiPagosACredenciales() {
  return {
    userPrincipalId: process.env.WOMPI_PAGOS_A_TERCEROS_USER_PRINCIPAL_ID ?? "",
    apiKey: process.env.WOMPI_PAGOS_A_TERCEROS_API_KEY ?? "",
  };
}

export interface PagoTerceroDestino {
  tipoCuenta: "AHORROS" | "CORRIENTE";
  numeroCuenta: string;
  tipoDocumento: "CC" | "CE" | "NIT" | "PP";
  numeroDocumento: string;
  nombreTitular: string;
}

export interface PagoTerceroParams {
  storeId: string;
  bankAccountId: string;
  amount: number; // en COP, enteros (centavos)
  reference: string;
  description?: string;
  destino?: PagoTerceroDestino;
}

export interface PagoTerceroResult {
  ok: boolean;
  providerPayoutId?: string;
  status?: string;
  error?: string;
}

async function obtenerCuentaBancaria(storeId: string, bankAccountId: string) {
  const [row] = await db
    .select()
    .from(merchantBankAccounts)
    .where(
      and(
        eq(merchantBankAccounts.id, bankAccountId),
        eq(merchantBankAccounts.storeId, storeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Envía un desembolso a Wompi Pagos a Terceros. */
export async function pagarTercero(params: PagoTerceroParams): Promise<PagoTerceroResult> {
  const { userPrincipalId, apiKey } = wompiPagosACredenciales();
  if (!userPrincipalId || !apiKey) {
    return {
      ok: false,
      error: "Wompi Pagos a Terceros no está configurado: falta user-principal-id o x-api-key.",
    };
  }

  const cuenta = await obtenerCuentaBancaria(params.storeId, params.bankAccountId);
  if (!cuenta) {
    return { ok: false, error: "Cuenta bancaria no encontrada." };
  }

  // Descifra el número de cuenta solo para enviarlo a Wompi.
  let numeroCuenta: string;
  try {
    numeroCuenta = decryptSecret(cuenta.encryptedAccountNumber);
  } catch {
    return { ok: false, error: "No se pudo descifrar la cuenta bancaria." };
  }

  const destino = params.destino ?? {
    tipoCuenta: (cuenta.accountType as "AHORROS" | "CORRIENTE") ?? "AHORROS",
    numeroCuenta,
    tipoDocumento: (cuenta.holderDocType as "CC" | "CE" | "NIT" | "PP") ?? "CC",
    numeroDocumento: cuenta.encryptedHolderDoc
      ? (() => {
          try {
            return decryptSecret(cuenta.encryptedHolderDoc);
          } catch {
            return "";
          }
        })()
      : "",
    nombreTitular: cuenta.holderName,
  };

  const payload = {
    destination: {
      type: "bank_account",
      bank_code: cuenta.bankCode,
      account_type: destino.tipoCuenta,
      account_number: destino.numeroCuenta,
      holder_name: destino.nombreTitular,
      holder_document_type: destino.tipoDocumento,
      holder_document_number: destino.numeroDocumento,
    },
    amount: Math.round(params.amount),
    currency: "COP",
    reference: params.reference.slice(0, 100),
    description: (params.description ?? "Pago a tercero Cici").slice(0, 200),
  };

  try {
    const res = await fetch(`${WOMPI_PAGOS_A_TERCEROS_BASE_URL}/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-principal-id": userPrincipalId,
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Wompi pagos a terceros: ${res.status} ${body.slice(0, 500)}`,
      };
    }

    const data = JSON.parse(body);
    const payoutData = data?.data ?? data;
    return {
      ok: true,
      providerPayoutId:
        payoutData?.id ?? payoutData?.payout_id ?? payoutData?.reference ?? "",
      status: payoutData?.status ?? "PROCESSING",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido en Wompi pagos a terceros.",
    };
  }
}
