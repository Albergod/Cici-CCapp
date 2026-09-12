import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { stores, mpPayments } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  MP_ACCESS_TOKEN,
  createMpPreference,
  getMpPayment,
} from "../lib/mercadopago";
import { priceFor, activatePaidPlan, getActivePrices } from "../lib/plans";
import { paymentLimiter } from "../middleware/rate-limit";

const router = Router();

// Rate limit: evita spam de preferencias de pago.
router.use(paymentLimiter);

const preferenceSchema = z.object({
  storeId: z.string().uuid(),
  plan: z.enum(["PRO", "BUSINESS"]),
  cycle: z.enum(["MONTHLY", "BI_MONTHLY"]),
});

// Crea la preferencia de Mercado Pago para el checkout.
// Devuelve la URL (init_point) a la que se redirige al cliente.
router.post("/preferences", requireAuth, async (req: AuthRequest, res) => {
  if (!MP_ACCESS_TOKEN) {
    return res
      .status(503)
      .json({ error: "Mercado Pago no está configurado aún (MP_ACCESS_TOKEN)" });
  }

  const parsed = preferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { storeId, plan, cycle } = parsed.data;

  // Solo el dueño de la tienda puede crear un cobro para su tienda.
  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      plan: stores.plan,
      ownerId: stores.ownerId,
    })
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.ownerId, req.userId!)))
    .limit(1);
  if (!store)
    return res.status(404).json({ error: "Tienda no encontrada o no eres su dueño." });

  const amount = priceFor(plan, cycle);
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  const backUrl = `${base}/dashboard`;

  try {
    const pref = await createMpPreference({
      title: PLAN_TITLE(plan, cycle),
      amount,
      externalReference: storeId, // identifica la tienda al volver/webhook
      backUrl,
      notificationUrl: `${base}/api/payments/mercadopago/webhook`,
      metadata: { storeId, plan, cycle, amount: String(amount) },
    });

    // En modo pruebas hay que usar el sandbox_init_point.
    const initPoint = pref.initPoint || pref.sandboxInitPoint;
    if (!initPoint) {
      return res.status(502).json({ error: "Mercado Pago no devolvió una URL de pago." });
    }
    res.json({ preferenceId: pref.id, initPoint, amount, cycle });
  } catch (err) {
    console.error("mercadopago create preference error:", err);
    res.status(502).json({ error: "No se pudo crear el pago en Mercado Pago." });
  }
});

function PLAN_TITLE(plan: "PRO" | "BUSINESS", cycle: "MONTHLY" | "BI_MONTHLY"): string {
  const prices = getActivePrices();
  const cycleText = cycle === "MONTHLY" ? "Mensual" : "Bimensual";
  const price = prices[cycle].amount;
  return `${plan === "PRO" ? "Espacio Premium" : "Espacio Business"} · ${cycleText} — $${price.toLocaleString("es-CO")}`;
}

// ── Verificación real de un pago ────────────────────────────────────────────
// Lo importante: esta ruta consulta el id del pago DIRECTAMENTE contra
// Mercado Pago. Solo si está "approved" activa el plan. Así un usuario NO puede
// fingir un retorno exitoso: sin pago real aprobado, nunca se activa PRO.
async function applyApprovedPayment(paymentId: string) {
  const payment = await getMpPayment(paymentId);
  if (!payment) return { approved: false, status: "not_found", detail: "not_found" };
  const status = payment.status;
  if (status !== "approved") {
    return { approved: false, status, detail: status };
  }

  const metadata = (payment.metadata ?? {}) as Record<string, string>;
  const plan = metadata.plan as "PRO" | "BUSINESS" | undefined;
  const cycle = metadata.cycle as "MONTHLY" | "BI_MONTHLY" | undefined;
  const amount = Number(metadata.amount ?? 0);

  if (!plan || !cycle) {
    return { approved: false, detail: "missing_metadata" };
  }
  // Precio correcto: rechazar un monto distinto al esperado.
  if (amount !== priceFor(plan, cycle)) {
    return { approved: false, detail: "amount_mismatch" };
  }

  const [existing] = await db
    .select()
    .from(mpPayments)
    .where(eq(mpPayments.mpPaymentId, paymentId))
    .limit(1);
  if (existing) {
    return { approved: true, status: "approved", alreadyProcessed: true, ...meta(plan, cycle) };
  }

  // Idempotencia: insertamos el pago y activamos el plan.
  const storeId = payment.externalReference ?? metadata.storeId;
  if (!storeId) return { approved: false, detail: "missing_store" };

  const [record] = await db
    .insert(mpPayments)
    .values({
      mpPaymentId: paymentId,
      status: payment.status,
      plan,
      cycle,
      amount: String(amount),
      storeId,
    })
    .returning({ id: mpPayments.id });

  try {
    await activatePaidPlan(storeId, plan, cycle);
  } catch (err) {
    console.error("activate plan error:", err);
    return { approved: false, detail: "activate_failed" };
  }
  return { approved: true, status: "approved", alreadyProcessed: false, recordId: record.id, ...meta(plan, cycle) };
}

function meta(plan: "PRO" | "BUSINESS", cycle: "MONTHLY" | "BI_MONTHLY") {
  return { plan, cycle, amount: priceFor(plan, cycle) };
}

// El frontend consulta aquí cuando el usuario vuelve del checkout (backUrl).
// Devuelve { approved, status } donde status puede ser:
//   "approved" | "pending" | "in_process" | "rejected" | "not_found"
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const paymentId = String(req.query.paymentId || "").trim();
  if (!paymentId) return res.status(400).json({ error: "Falta paymentId" });

  try {
    const result = await applyApprovedPayment(paymentId);
    res.json(result);
  } catch (err) {
    console.error("payment status error:", err);
    res.status(502).json({ error: "No se pudo verificar el pago." });
  }
});

// Webhook de Mercado Pago: Mercado Pago nos notifica el estado del pago.
// Debe responder 200 rápido; el procesamiento es idempotente.
router.post("/mercadopago/webhook", async (req, res) => {
  res.status(200).json({ ok: true });
  const body = req.body ?? {};
  const topic = body.type ?? body.topic; // "payment" | ...
  const resource = body.data?.id ?? body.resource ?? body.id;

  if (topic === "payment" && resource) {
    const paymentId = String(resource);
    try {
      await applyApprovedPayment(paymentId);
    } catch (err) {
      console.error("webhook apply payment error:", err);
    }
  }
});

// Mercado Pago a veces valida el URL del webhook con un GET.
router.get("/mercadopago/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;