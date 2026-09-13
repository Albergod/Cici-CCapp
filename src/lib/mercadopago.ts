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

// Orders API exige montos sin decimales a menos que existan; los precios de los
// planes son enteros.
function fmtAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export async function createMpOrder(params: {
  title: string;
  amount: number;
  externalReference: string;
  backUrl: string;
}): Promise<{ id: string; initPoint: string | null; sandboxInitPoint: string | null }> {
  const res = await fetch(`${MP_API_BASE}/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      type: "online",
      processing_mode: "manual",
      total_amount: fmtAmount(params.amount),
      external_reference: params.externalReference,
      items: [
        {
          title: params.title,
          quantity: 1,
          unit_price: fmtAmount(params.amount),
        },
      ],
      config: {
        online: {
          success_url: params.backUrl,
          failure_url: params.backUrl,
          pending_url: params.backUrl,
          auto_return: "approved",
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mercado Pago Orders: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id?: string;
    checkout_url?: string | null;
    sandbox_checkout_url?: string | null;
  };
  return {
    id: data.id ?? "",
    initPoint: data.checkout_url ?? null,
    sandboxInitPoint: data.sandbox_checkout_url ?? null,
  };
}

export async function getMpOrder(orderId: string): Promise<{
  id: string;
  status: string;
  statusDetail: string | null;
  totalAmount: number | null;
  externalReference: string | null;
  payments: Array<{ id: string; status: string; amount: number }>;
} | null> {
  const res = await fetch(`${MP_API_BASE}/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mercado Pago Order: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id?: string;
    status?: string | null;
    status_detail?: string | null;
    total_amount?: string | number;
    external_reference?: string | null;
    payments?: Array<{
      id?: string | number;
      status?: string | null;
      amount?: string | number;
    }>;
  };
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "",
    statusDetail: data.status_detail ?? null,
    totalAmount: typeof data.total_amount === "string" ? Number(data.total_amount) : data.total_amount ?? null,
    externalReference: data.external_reference ?? null,
    payments: (data.payments ?? []).map((p) => ({
      id: String(p.id ?? ""),
      status: p.status ?? "",
      amount: typeof p.amount === "string" ? Number(p.amount) : p.amount ?? 0,
    })),
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