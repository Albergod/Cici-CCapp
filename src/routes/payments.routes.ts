import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { stores, mpPayments } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  MP_ACCESS_TOKEN,
  createMpOrder,
  getMpOrder,
  getMpPayment,
} from "../lib/mercadopago";
import { priceFor, activatePaidPlan, getActivePrices } from "../lib/plans";
import { parseExternalRef } from "../lib/payment-ref";
import { paymentLimiter } from "../middleware/rate-limit";

const router = Router();

// Rate limit: evita spam de preferencias de pago.
router.use(paymentLimiter);

const preferenceSchema = z.object({
  storeId: z.string().uuid().optional(),
  plan: z.enum(["PRO", "BUSINESS"]),
  cycle: z.enum(["MONTHLY", "BI_MONTHLY"]),
});

// Crea la preferencia de Mercado Pago para el checkout.
// Devuelve la URL (init_point) a la que se redirige al cliente.
// Sin storeId el pago queda asociado al usuario (referencia USER_<id>_...):
// el plan se activa cuando el comerciante cree su tienda.
router.post("/preferences", requireAuth, async (req: AuthRequest, res) => {
  if (!MP_ACCESS_TOKEN) {
    return res
      .status(503)
      .json({ error: "Mercado Pago no está configurado aún (MP_ACCESS_TOKEN)" });
  }

  const parsed = preferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { storeId, plan, cycle } = parsed.data;

  // Solo el dueño de la tienda puede crear un cobro para su tienda. Si no se
  // pasa storeId (pago para una tienda aún por crear), no hay tienda que validar.
  if (storeId) {
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
  }

  const amount = priceFor(plan, cycle);
  const base =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;
    const backUrl = `${base}/dashboard`;
    // En Orders API no existe metadata: guardamos qué se vendió en
    // external_reference (máx 64 chars). Con tienda: storeId_PLAN_CYCLE.
    // Sin tienda: USER_<userId>_PLAN_CYCLE (el plan se aplica al crear la tienda).
    const externalReference = storeId
      ? `${storeId}_${plan}_${cycle}`
      : `USER_${req.userId}_${plan}_${cycle}`;

    try {
      const order = await createMpOrder({
        title: PLAN_TITLE(plan, cycle),
        amount,
        externalReference,
        backUrl,
      });

      const initPoint = order.initPoint || order.sandboxInitPoint;
    if (!initPoint) {
      return res.status(502).json({ error: "Mercado Pago no devolvió una URL de pago." });
    }
    res.json({ preferenceId: order.id, initPoint, amount, cycle });
  } catch (err) {
    console.error("mercadopago create order error:", err);
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
//
// Con Orders API el pago ya no trae metadata. Guardamos qué se vendió en
// external_reference con el formato "${storeId}_${plan}_${cycle}" y lo
// recuperamos al verificar (parseExternalRef vive en src/lib/payment-ref.ts).
async function applyApprovedPayment(ref: string) {
  const isOrder = /^ORD/i.test(ref);
  let status: string;
  let externalReference: string | null;
  let amount: number | null;
  let mpId = ref;

  if (isOrder) {
    const order = await getMpOrder(ref);
    if (!order) return { approved: false, status: "not_found", detail: "not_found" };
    status = order.status;
    externalReference = order.externalReference;
    amount = order.totalAmount;
    // Para la tabla de pagos usamos el primer pago aprobado de la order si existe.
    const paid = order.payments.find((p) => p.status === "approved");
    if (paid) mpId = paid.id;
  } else {
    const payment = await getMpPayment(ref);
    if (!payment) return { approved: false, status: "not_found", detail: "not_found" };
    status = payment.status;
    externalReference = payment.externalReference;
    amount = payment.transactionAmount;
    if (payment.id) mpId = payment.id;
  }

  if (status !== "approved") {
    return { approved: false, status, detail: status };
  }

  const parsed = parseExternalRef(externalReference ?? "");
  let plan: "PRO" | "BUSINESS" | undefined;
  let cycle: "MONTHLY" | "BI_MONTHLY" | undefined;
  let storeId: string | null | undefined;
  let userId: string | undefined;

  if (parsed) {
    ({ plan, cycle } = parsed);
    storeId = "storeId" in parsed ? parsed.storeId : null;
    userId = "userId" in parsed ? parsed.userId : undefined;
  } else {
    return { approved: false, detail: "missing_plan" };
  }

  if (!plan || !cycle) {
    return { approved: false, detail: "missing_plan" };
  }
  // Precio correcto: rechazar un monto distinto al esperado.
  if (amount !== null && amount > 0 && amount !== priceFor(plan, cycle)) {
    return { approved: false, detail: "amount_mismatch" };
  }

  const [existing] = await db
    .select()
    .from(mpPayments)
    .where(eq(mpPayments.mpPaymentId, mpId))
    .limit(1);
  if (existing) {
    return { approved: true, status: "approved", alreadyProcessed: true, ...meta(plan, cycle) };
  }

  // Idempotencia: insertamos el pago y activamos el plan.
  const [record] = await db
    .insert(mpPayments)
    .values({
      mpPaymentId: mpId,
      status: "approved",
      plan,
      cycle,
      amount: String(amount ?? priceFor(plan, cycle)),
      storeId: storeId ?? null,
      ...(userId ? { userId } : {}),
    })
    .returning({ id: mpPayments.id });

  // Si el pago fue para una tienda existente, la activamos ya. Si fue un pago
  // SIN tienda (referencia USER_...), el plan se activa en store.routes.ts al
  // crear la tienda.
  if (storeId) {
    try {
      await activatePaidPlan(storeId, plan, cycle);
    } catch (err) {
      console.error("activate plan error:", err);
      return { approved: false, detail: "activate_failed" };
    }
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
  const topic = body.type ?? body.topic; // "payment" | "order"
  const resource = body.data?.id ?? body.resource ?? body.id;

  if (!resource) return;
  const id = String(resource);

  try {
    if (topic === "order" || /^ORD/i.test(id)) {
      // Orders API: verificamos la order y su primer pago aprobado.
      const now = await applyApprovedPayment(id);
      if (!now.approved && now.status !== "approved") {
        const order = await getMpOrder(id);
        const paid = order?.payments.find((p) => p.status === "approved");
        if (paid?.id) await applyApprovedPayment(paid.id);
      }
    } else {
      await applyApprovedPayment(id);
    }
  } catch (err) {
    console.error("webhook apply payment error:", err);
  }
});

// Mercado Pago a veces valida el URL del webhook con un GET.
router.get("/mercadopago/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;