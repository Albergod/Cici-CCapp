// Integración con Mercado Pago (Checkout Pro).
// Doc: https://www.mercadopago.com.co/developers/es/docs/checkout-pro/landing
//
// Configuración requerida en .env:
//   MP_ACCESS_TOKEN   → tu Access Token de producción (APP_USR-...) o de pruebas (TEST-...)
//   MP_PUBLIC_KEY     → opcional (solo sería necesaria para Checkout Bricks)
//
// La URL del webhook se construye automáticamente desde el host del request
// (p.ej. https://midominio.com/api/payments/mercadopago/webhook), por eso en
// pruebas locales el webhook no recibe las notificaciones hasta subir la app a
// Internet (Railway/Render/Clouding).

const MP_API_BASE = "https://api.mercadopago.com";

export const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";

export async function createMpPreference(params: {
  title: string;
  amount: number;
  externalReference: string;
  backUrl: string;
  notificationUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; initPoint: string | null; sandboxInitPoint: string | null }> {
  const res = await fetch(`${MP_API_BASE}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          title: params.title,
          quantity: 1,
          unit_price: params.amount,
          currency_id: "COP",
        },
      ],
      auto_return: "approved",
      back_urls: { success: params.backUrl, failure: params.backUrl, pending: params.backUrl },
      notification_url: params.notificationUrl,
      external_reference: params.externalReference,
      metadata: params.metadata,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mercado Pago: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id?: string;
    init_point?: string | null;
    sandbox_init_point?: string | null;
  };
  return {
    id: data.id ?? "",
    initPoint: data.init_point ?? null,
    sandboxInitPoint: data.sandbox_init_point ?? null,
  };
}

export async function getMpPayment(paymentId: string): Promise<{
  id: string;
  status: string;
  statusDetail: string | null;
  transactionAmount: number | null;
  externalReference: string | null;
  metadata: Record<string, unknown> | null;
} | null> {
  const res = await fetch(`${MP_API_BASE}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mercado Pago: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id?: string | number;
    status?: string | null;
    status_detail?: string | null;
    transaction_amount?: number | null;
    external_reference?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "",
    statusDetail: data.status_detail ?? null,
    transactionAmount: typeof data.transaction_amount === "number" ? data.transaction_amount : null,
    externalReference: data.external_reference ?? null,
    metadata: data.metadata ?? null,
  };
}