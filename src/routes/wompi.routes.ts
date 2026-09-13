// Pagos con Nequi vía Wompi. Comparte la misma regla de negocio que Mercado
// Pago: el plan se activa SOLO cuando Wompi confirma la transacción como
// APPROVED (webhook firmado o verificación on-demand contra Wompi).
import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { users, stores, mpPayments } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  WOMPI_PRIVATE_KEY,
  WOMPI_PUBLIC_KEY,
  WOMPI_EVENTS_KEY,
  createNequiTransaction,
  getWompiTransaction,
  verifyWompiWebhook,
} from "../lib/wompi";
import { parseExternalRef } from "../lib/payment-ref";
import { priceFor, activatePaidPlan } from "../lib/plans";

const router = Router();

const nequiSchema = z.object({
  storeId: z.string().uuid().optional(),
  plan: z.enum(["PRO", "BUSINESS"]),
  cycle: z.enum(["MONTHLY", "BI_MONTHLY"]),
  phoneNumber: z
    .string()
    .regex(/^3\d{9}$/, "Número Nequi inválido. Usa 10 dígitos, p.ej. 3101234567"),
});

// Crea el cobro por Nequi. Wompi envía una notificación push a la app Nequi
// del número indicado; el comprador la aprueba desde ahí. La transacción nace
// PENDING y queda registrada en mp_payments para que el webhook/polling la
// cierre de forma idempotente.
router.post("/nequi", requireAuth, async (req: AuthRequest, res) => {
  if (!WOMPI_PRIVATE_KEY || !WOMPI_PUBLIC_KEY) {
    return res
      .status(503)
      .json({ error: "Wompi no está configurado aún (llaves WOMPI_*)" });
  }

  const parsed = nequiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { storeId, plan, cycle, phoneNumber } = parsed.data;

  // Con storeId validamos la propiedad. Sin storeId (pago para una tienda aún
  // por crear) el cobro queda asociado al usuario y el plan se aplica al crear
  // la tienda en store.routes.ts.
  if (storeId) {
    const [store] = await db
      .select({ id: stores.id, name: stores.name, plan: stores.plan, ownerId: stores.ownerId })
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.ownerId, req.userId!)))
      .limit(1);
    if (!store)
      return res.status(404).json({ error: "Tienda no encontrada o no eres su dueño." });
  }

  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, req.userId!))
    .limit(1);

  const amount = priceFor(plan, cycle);
  const reference = crypto.randomUUID();

  try {
    const tx = await createNequiTransaction({
      amountInCents: amount * 100,
      reference,
      customerEmail: owner?.email ?? "cliente@ccplatform.com",
      phoneNumber,
    });

    if (tx.id) {
      await db
        .insert(mpPayments)
        .values({
          mpPaymentId: tx.id,
          status: "pending",
          plan,
          cycle,
          amount: String(amount),
          storeId: storeId ?? null,
          userId: req.userId!,
        })
        .onConflictDoNothing();
    }

    res.json({ transactionId: tx.id, status: tx.status, reference, amount, cycle });
  } catch (err) {
    console.error("wompi create nequi error:", err);
    res.status(502).json({ error: "No se pudo crear el cobro por Nequi." });
  }
});

function meta(plan: "PRO" | "BUSINESS", cycle: "MONTHLY" | "BI_MONTHLY") {
  return { plan, cycle, amount: priceFor(plan, cycle) };
}

// Idempotente: confirma una transacción Nequi APPROVED y activa el plan.
// Recupera storeId/plan/ciclo de la fila "pending" registrada al crear el
// cobro (mpPaymentId = id de la transacción Wompi). Si no la encuentra, asume
// una transacción externa y cae al formato de referencia storeId_PLAN_CYCLE.
async function applyWompiApproved(tx: {
  id: string;
  status: string;
  reference: string | null;
  amountInCents: number | null;
}) {
  if (tx.status !== "APPROVED") {
    return { approved: false, status: String(tx.status || "unknown").toLowerCase(), detail: String(tx.status || "unknown").toLowerCase() };
  }

  const [pending] = await db
    .select()
    .from(mpPayments)
    .where(eq(mpPayments.mpPaymentId, tx.id))
    .limit(1);

  let storeId: string | null;
  let plan: "PRO" | "BUSINESS";
  let cycle: "MONTHLY" | "BI_MONTHLY";
  let userId: string | null = null;

  if (pending) {
    storeId = pending.storeId;
    plan = pending.plan as "PRO" | "BUSINESS";
    cycle = pending.cycle;
    userId = pending.userId;
  } else {
    const fallback = parseExternalRef(tx.reference ?? "");
    if (!fallback) return { approved: false, detail: "missing_plan" };
    plan = fallback.plan;
    cycle = fallback.cycle;
    storeId = "storeId" in fallback ? fallback.storeId : null;
    userId = "userId" in fallback ? fallback.userId : null;
  }

  const expectedCents = priceFor(plan, cycle) * 100;
  if (tx.amountInCents !== null && tx.amountInCents > 0 && tx.amountInCents !== expectedCents) {
    return { approved: false, detail: "amount_mismatch" };
  }

  if (pending?.status === "approved") {
    return { approved: true, status: "approved", alreadyProcessed: true, ...meta(plan, cycle) };
  }

  if (pending) {
    await db
      .update(mpPayments)
      .set({ status: "approved" })
      .where(eq(mpPayments.id, pending.id));
  } else {
    await db
      .insert(mpPayments)
      .values({
        mpPaymentId: tx.id,
        status: "approved",
        plan,
        cycle,
        amount: String(priceFor(plan, cycle)),
        storeId,
        ...(userId ? { userId } : {}),
      })
      .onConflictDoNothing();
  }

  // Pago SIN tienda (reference USER_...): el plan se activa al crear la tienda
  // en store.routes.ts. Con tienda, activamos aquí.
  if (storeId) {
    try {
      await activatePaidPlan(storeId, plan, cycle);
    } catch (err) {
      console.error("activate plan error:", err);
      return { approved: false, detail: "activate_failed" };
    }
  }
  return { approved: true, status: "approved", alreadyProcessed: false, ...meta(plan, cycle) };
}

// El frontend consulta aquí mientras el usuario espera la confirmación en Nequi.
// Devuelve { approved, status } igual que el /status de Mercado Pago.
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const transactionId = String(req.query.transactionId || "").trim();
  if (!transactionId) return res.status(400).json({ error: "Falta transactionId" });

  try {
    const tx = await getWompiTransaction(transactionId);
    if (!tx) return res.json({ approved: false, status: "not_found", detail: "not_found" });
    const result = await applyWompiApproved(tx);
    res.json(result);
  } catch (err) {
    console.error("wompi status error:", err);
    res.status(502).json({ error: "No se pudo verificar el pago." });
  }
});

// Webhook de Wompi: nos notifica transaction.updated. Responde 200 primero;
// el procesamiento es idempotente y solo activa el plan si la firma es válida
// y la transacción está APPROVED. URL en el panel de Wompi:
// https://<dominio>/api/payments/wompi/webhook
router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });
  if (!WOMPI_EVENTS_KEY) return;

  const body = req.body ?? {};
  const checksum = String(req.headers["x-event-checksum"] ?? "");
  if (!verifyWompiWebhook(body, checksum)) {
    console.warn("wompi webhook: firma inválida");
    return;
  }

  const tx = body?.data?.transaction;
  if (!tx || tx.status !== "APPROVED") return;

  try {
    const full = await getWompiTransaction(String(tx.id ?? ""));
    if (full) await applyWompiApproved(full);
  } catch (err) {
    console.error("wompi webhook error:", err);
  }
});

router.get("/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;