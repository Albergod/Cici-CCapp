// Integración con Wompi (Grupo Bancolombia) para pagos con Nequi.
// Doc: https://docs.wompi.co/en/docs/colombia/transacciones
//
// Configuración en .env:
//   WOMPI_PUBLIC_KEY     → pub_prod_... o pub_test_...
//   WOMPI_PRIVATE_KEY    → prv_prod_... o prv_test_... (solo servidor)
//   WOMPI_INTEGRITY_KEY  → prod_integrity_... o test_integrity_...
//   WOMPI_EVENTS_KEY     → prod_events_... o test_events_...
//
// Para pasar a PRODUCCIÓN solo hay que reemplazar las 4 llaves por las de
// producción: el entorno se deduce del prefijo (_test_ → sandbox,
// _prod_ → producción). WOMPI_SANDBOX es solo un respaldo por si no hay llaves.
//
// Flujo Nequi: se crea la transacción → al cliente le llega una notificación
// push en su app Nequi para aprobar el pago → Wompi nos notifica por webhook
// (transaction.updated) y/o el frontend consulta /status.

import crypto from "node:crypto";

const WOMPI_SANDBOX_BASE = "https://sandbox.wompi.co/v1";
const WOMPI_PRODUCTION_BASE = "https://production.wompi.co/v1";

export const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || "";
export const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "";
export const WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "";
export const WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "";

// Deducir el entorno de las llaves para que el único cambio al pasar a
// producción sean las llaves: si empiezan por _prod_ → producción, si por
// _test_ → sandbox. WOMPI_SANDBOX solo se usa como respaldo cuando no hay
// llaves (p. ej. arranque local sin configurar). Así, reemplazar las llaves
// de prueba por las de producción cambia el entorno aunque WOMPI_SANDBOX siga
// en "true".
function resolveWompiEnv(): "sandbox" | "production" {
  const keys = `${WOMPI_PUBLIC_KEY} ${WOMPI_PRIVATE_KEY}`;
  if (/_prod_/.test(keys)) return "production";
  if (/_test_/.test(keys)) return "sandbox";
  return process.env.WOMPI_SANDBOX === "false" ? "production" : "sandbox";
}

export const WOMPI_ENV: "sandbox" | "production" = resolveWompiEnv();

const WOMPI_BASE = WOMPI_ENV === "production" ? WOMPI_PRODUCTION_BASE : WOMPI_SANDBOX_BASE;

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

interface WompiTransactionResult {
  id: string;
  status: string;
  /** URL del banco para completar un pago asíncrono (PSE). */
  redirectUrl: string | null;
}

function extractRedirectUrl(data: Record<string, any>): string | null {
  const extra = data?.payment_method?.extra ?? {};
  return (
    extra.async_payment_url ??
    extra.redirect_url ??
    extra.pse_payment_url ??
    data?.redirect_url ??
    data?.url ??
    null
  );
}

async function createWompiTransaction(
  params: Record<string, unknown>,
): Promise<WompiTransactionResult> {
  const acceptance = await getWompiAcceptance();
  if (!acceptance.acceptanceToken) {
    throw new Error("Wompi no devolvió el token de aceptación");
  }

  const reference = String(params.reference ?? "");
  const amountInCents = Number(params.amount_in_cents ?? 0);
  const payload: Record<string, unknown> = {
    ...params,
    currency: "COP",
    acceptance_token: acceptance.acceptanceToken,
    signature: wompiIntegritySignature(reference, amountInCents),
  };
  // accept_personal_auth solo se envía si Wompi entregó el token de Habeas Data.
  if (acceptance.personalDataAuthToken) {
    payload.accept_personal_auth = acceptance.personalDataAuthToken;
  }

  const res = await fetch(`${WOMPI_BASE}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wompi transaction: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = ((await res.json()) as { data?: Record<string, any> }).data ?? {};
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "PENDING",
    redirectUrl: extractRedirectUrl(data),
  };
}

export async function createNequiTransaction(params: {
  amountInCents: number;
  reference: string;
  customerEmail: string;
  phoneNumber: string;
}): Promise<WompiTransactionResult> {
  return createWompiTransaction({
    amount_in_cents: params.amountInCents,
    customer_email: params.customerEmail,
    reference: params.reference,
    payment_method: {
      type: "NEQUI",
      phone_number: params.phoneNumber,
    },
  });
}

export interface PsePaymentData {
  /** 0 = persona natural, 1 = persona jurídica (Wompi). */
  userType: 0 | 1;
  /** CC, CE, NIT, PP, etc. */
  legalIdType: string;
  legalId: string;
  /** Código de la institución financiera (GET /pse/financial_institutions). */
  financialInstitutionCode: string;
  fullName?: string;
  description?: string;
}

// PSE es asíncrono: la transacción nace PENDING y el comprador completa el
// pago en el banco. La respuesta trae la URL del banco. NUNCA se asume que el
// pago se aprobó por volver a Cici: se confirma por webhook y/o /status.
export async function createPseTransaction(params: {
  amountInCents: number;
  reference: string;
  customerEmail: string;
  pse: PsePaymentData;
}): Promise<WompiTransactionResult> {
  return createWompiTransaction({
    amount_in_cents: params.amountInCents,
    customer_email: params.customerEmail,
    reference: params.reference,
    payment_method: {
      type: "PSE",
      user_type: params.pse.userType,
      user_legal_id_type: params.pse.legalIdType,
      user_legal_id: params.pse.legalId,
      financial_institution_code: params.pse.financialInstitutionCode,
      payment_description:
        (params.pse.description ?? "Compra en Cici").slice(0, 80),
      ...(params.pse.fullName ? { full_name: params.pse.fullName } : {}),
    },
  });
}

export interface PseInstitution {
  code: string;
  name: string;
}

/** Instituciones financieras habilitadas para PSE en la cuenta Wompi. */
export async function getWompiPseInstitutions(): Promise<PseInstitution[]> {
  const res = await fetch(`${WOMPI_BASE}/pse/financial_institutions`, {
    headers: { Authorization: `Bearer ${WOMPI_PUBLIC_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wompi PSE institutions: ${res.status} ${body.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { data?: any[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows
    .map((row) => ({
      code: String(
        row.financial_institution_code ??
          row.code ??
          row.id ??
          "",
      ),
      name: String(
        row.financial_institution_name ??
          row.name ??
          row.description ??
          "",
      ),
    }))
    .filter((row) => row.code && row.name);
}

export async function getWompiTransaction(id: string): Promise<{
  id: string;
  status: string;
  reference: string | null;
  amountInCents: number | null;
  paymentMethodType: string | null;
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
      payment_method?: { type?: string | null } | null;
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
    paymentMethodType: data.payment_method?.type ?? null,
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