// Integración con Wompi (Grupo Bancolombia) para pagos con Nequi.
// Doc: https://docs.wompi.co/en/docs/colombia/transacciones
//
// Configuración en .env:
//   WOMPI_PUBLIC_KEY     → pub_prod_... o pub_test_...
//   WOMPI_PRIVATE_KEY    → prv_prod_... o prv_test_... (solo servidor)
//   WOMPI_INTEGRITY_KEY  → prod_integrity_... o test_integrity_...
//   WOMPI_EVENTS_KEY     → prod_events_... o test_events_...
//   WOMPI_SANDBOX        → "true" para usar el entorno de pruebas
//
// Flujo Nequi: se crea la transacción → al cliente le llega una notificación
// push en su app Nequi para aprobar el pago → Wompi nos notifica por webhook
// (transaction.updated) y/o el frontend consulta /status.

import crypto from "node:crypto";

const WOMPI_BASE =
  process.env.WOMPI_SANDBOX === "true"
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";

export const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || "";
export const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "";
export const WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "";
export const WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "";

interface Acceptance {
  acceptanceToken: string | null;
  personalDataAuthToken: string | null;
}

// Tokens de aceptación (ley Habeas Data). Son de corta vida: se obtienen por
// cada transacción. El endpoint solo necesita la llave pública.
export async function getWompiAcceptance(): Promise<Acceptance> {
  const res = await fetch(`${WOMPI_BASE}/merchants/${WOMPI_PUBLIC_KEY}`, {
    headers: { Authorization: `Bearer ${WOMPI_PUBLIC_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wompi merchants: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = ((await res.json()) as { data?: Record<string, any> }).data ?? {};
  return {
    acceptanceToken: data.presigned_acceptance?.acceptance_token ?? null,
    personalDataAuthToken:
      data.presigned_personal_data_auth?.acceptance_token ?? null,
  };
}

// Firma de integridad: sha256 hex (minúsculas) de
// reference + amount_in_cents + currency + integrity_key.
export function wompiIntegritySignature(
  reference: string,
  amountInCents: number,
): string {
  const raw = `${reference}${amountInCents}COP${WOMPI_INTEGRITY_KEY}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function createNequiTransaction(params: {
  amountInCents: number;
  reference: string;
  customerEmail: string;
  phoneNumber: string;
}): Promise<{ id: string; status: string }> {
  const acceptance = await getWompiAcceptance();
  if (!acceptance.acceptanceToken) {
    throw new Error("Wompi no devolvió el token de aceptación");
  }

  const res = await fetch(`${WOMPI_BASE}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount_in_cents: params.amountInCents,
      currency: "COP",
      customer_email: params.customerEmail,
      reference: params.reference,
      acceptance_token: acceptance.acceptanceToken,
      accept_personal_auth: acceptance.personalDataAuthToken,
      signature: wompiIntegritySignature(params.reference, params.amountInCents),
      payment_method: {
        type: "NEQUI",
        phone_number: params.phoneNumber,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wompi transaction: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = ((await res.json()) as { data?: { id?: string; status?: string } }).data ?? {};
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "PENDING",
  };
}

export async function getWompiTransaction(id: string): Promise<{
  id: string;
  status: string;
  reference: string | null;
  amountInCents: number | null;
} | null> {
  const res = await fetch(`${WOMPI_BASE}/transactions/${id}`, {
    headers: { Authorization: `Bearer ${WOMPI_PRIVATE_KEY}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wompi transaction: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = ((await res.json()) as {
    data?: {
      id?: string;
      status?: string;
      reference?: string | null;
      amount_in_cents?: number | string | null;
    };
  }).data ?? {};
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "",
    reference: data.reference ?? null,
    amountInCents:
      typeof data.amount_in_cents === "number"
        ? data.amount_in_cents
        : data.amount_in_cents
          ? Number(data.amount_in_cents)
          : null,
  };
}

// Valida la firma de un webhook de Wompi (header X-Event-Checksum).
// Algoritmo: sha256 hex (mayúsculas) de
// <valores de signature.properties en orden><timestamp><events_key>.
export function verifyWompiWebhook(
  body: Record<string, any>,
  checksumHeader?: string,
): boolean {
  const signature = body?.signature;
  if (
    !signature ||
    !Array.isArray(signature.properties) ||
    signature.timestamp === undefined
  ) {
    return false;
  }

  const parts: string[] = [];
  for (const path of signature.properties) {
    if (typeof path !== "string") return false;
    const value = path.split(".").reduce<any>((obj, key) => obj?.[key], body?.data);
    if (value === undefined) return false;
    parts.push(String(value));
  }

  const raw = parts.join("") + String(signature.timestamp) + WOMPI_EVENTS_KEY;
  const expected = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex")
    .toUpperCase();

  const received = checksumHeader || signature.checksum;
  if (!received) return false;
  return expected === String(received).toUpperCase();
}