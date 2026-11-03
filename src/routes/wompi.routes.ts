// Pagos con Nequi vía Wompi. Comparte la misma regla de negocio que Mercado
// Pago: el plan se activa SOLO cuando Wompi confirma la transacción como
// APPROVED (webhook firmado o verificación on-demand contra Wompi).
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "../db/client";
import {
  users,
  stores,
  mpPayments,
  payments,
  paymentWebhookEvents,
  protectedPayments,
} from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  WOMPI_PRIVATE_KEY,
  WOMPI_PUBLIC_KEY,
  WOMPI_EVENTS_KEY,
  createNequiTransaction,
  getWompiPseInstitutions,
  getWompiTransaction,
  verifyWompiWebhook,
} from "../lib/wompi";
import { pseInstitutionsLimiter } from "../middleware/rate-limit";
import { parseExternalRef } from "../lib/payment-ref";
import { paymentEnvironmentError } from "../lib/env";
import { priceFor, activatePaidPlan } from "../lib/plans";
import { applyProtectedApproved } from "./protected.routes";

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
  const envError = paymentEnvironmentError();
  if (envError) return res.status(503).json({ error: envError });
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
    // Claim atómico: si dos webhooks/pollings llegan a la vez, solo uno pasa
    // de pending a approved y activa el plan; el otro responde "ya procesado".
    const [claimed] = await db
      .update(mpPayments)
      .set({ status: "approved" })
      .where(and(eq(mpPayments.id, pending.id), ne(mpPayments.status, "approved")))
      .returning({ id: mpPayments.id });
    if (!claimed) {
      return { approved: true, status: "approved", alreadyProcessed: true, ...meta(plan, cycle) };
    }
  } else {
    const [inserted] = await db
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
      .onConflictDoNothing()
      .returning({ id: mpPayments.id });
    if (!inserted) {
      return { approved: true, status: "approved", alreadyProcessed: true, ...meta(plan, cycle) };
    }
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

// Bancos disponibles para PSE. Es información pública de catálogo (no cobra
// nada): se cachea unos minutos para no golpear a Wompi en cada checkout.
let pseCache: { at: number; data: { code: string; name: string }[] } | null = null;

router.get("/pse/institutions", pseInstitutionsLimiter, async (_req, res) => {
  if (!WOMPI_PUBLIC_KEY) {
    return res.status(503).json({ error: "Wompi no está configurado aún (llaves WOMPI_*)" });
  }
  if (pseCache && Date.now() - pseCache.at < 10 * 60 * 1000) {
    return res.json({ institutions: pseCache.data });
  }
  try {
    const institutions = await getWompiPseInstitutions();
    pseCache = { at: Date.now(), data: institutions };
    res.json({ institutions });
  } catch (err) {
    console.error("wompi pse institutions error:", err);
    res.status(502).json({ error: "No se pudieron cargar los bancos de PSE." });
  }
});

/** Id determinista del evento firmado: el reenvío no se procesa dos veces. */
function webhookEventId(body: Record<string, any>): string {
  const tx = body?.data?.transaction ?? {};
  const raw = [
    body?.event ?? "",
    tx.id ?? "",
    tx.status ?? "",
    body?.signature?.timestamp ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

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

  // Idempotencia a nivel de evento: si Wompi reenvía el mismo, se ignora.
  const eventId = webhookEventId(body);
  const [eventRow] = await db
    .insert(paymentWebhookEvents)
    .values({
      provider: "WOMPI",
      eventId,
      eventType: String(body?.event ?? "").slice(0, 120),
      status: "RECEIVED",
      payload: body as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: paymentWebhookEvents.id });
  if (!eventRow) return;

  const tx = body?.data?.transaction;
  if (!tx) {
    await db
      .update(paymentWebhookEvents)
      .set({ status: "IGNORED", processedAt: new Date() })
      .where(eq(paymentWebhookEvents.id, eventRow.id));
    return;
  }

  try {
    const full = await getWompiTransaction(String(tx.id ?? ""));
    if (!full) {
      await db
        .update(paymentWebhookEvents)
        .set({ status: "IGNORED", processedAt: new Date() })
        .where(eq(paymentWebhookEvents.id, eventRow.id));
      return;
    }

    // Mantén el estado del pago normalizado aunque no sea APPROVED.
    if (full.status !== "APPROVED") {
      const mapped =
        full.status === "DECLINED" || full.status === "VOIDED" || full.status === "ERROR"
          ? full.status
          : null;
      if (mapped) {
        await db
          .update(payments)
          .set({ status: mapped, updatedAt: new Date() })
          .where(
            and(
              eq(payments.provider, "WOMPI"),
              eq(payments.providerTransactionId, full.id),
            ),
          );
      }
      await db
        .update(paymentWebhookEvents)
        .set({ status: "PROCESSED", processedAt: new Date() })
        .where(eq(paymentWebhookEvents.id, eventRow.id));
      return;
    }

    // Pago protegido piloto primero (por tx id); si lo maneja, no es un plan.
    const { applyProtectedApproved } = await import("./protected.routes");
    const prot = await applyProtectedApproved(full);
    if (!prot.handled) await applyWompiApproved(full);

    await db
      .update(paymentWebhookEvents)
      .set({ status: "PROCESSED", processedAt: new Date() })
      .where(eq(paymentWebhookEvents.id, eventRow.id));
  } catch (err) {
    console.error("wompi webhook error:", err);
    await db
      .update(paymentWebhookEvents)
      .set({
        status: "FAILED",
        error: err instanceof Error ? err.message.slice(0, 500) : "error",
        processedAt: new Date(),
      })
      .where(eq(paymentWebhookEvents.id, eventRow.id))
      .catch(() => undefined);
  }
});

/** Reconciliación manual: verifica pagos protegidos pendientes contra Wompi y
 * aplica los aprobados. Útil si un webhook se perdió entre que la app respondió
 * 200 y terminó de procesar. Solo aplica a pagos de la propia tienda. */
router.post("/reconcile", requireAuth, async (req: AuthRequest, res) => {
  if (!WOMPI_PRIVATE_KEY || !WOMPI_PUBLIC_KEY) {
    return res.status(503).json({ error: "Wompi no está configurado." });
  }
  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!))
    .limit(1);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const rows = await db
    .select({
      id: protectedPayments.id,
      orderId: protectedPayments.orderId,
      wompiTxId: protectedPayments.wompiTxId,
      status: protectedPayments.status,
    })
    .from(protectedPayments)
    .where(
      and(
        eq(protectedPayments.storeId, store.id),
        isNotNull(protectedPayments.wompiTxId),
        inArray(protectedPayments.status, ["initiated", "collected"]),
      ),
    );

  const results = [];
  let reconciled = 0;
  for (const row of rows) {
    try {
      const tx = await getWompiTransaction(String(row.wompiTxId ?? ""));
      if (!tx) {
        results.push({ orderId: row.orderId, wompiTxId: row.wompiTxId, applied: false, reason: "no_tx" });
        continue;
      }
      if (tx.status === "APPROVED") {
        const prot = await applyProtectedApproved(tx);
        if (prot.handled) reconciled++;
        results.push({ orderId: row.orderId, wompiTxId: row.wompiTxId, applied: prot.handled, status: tx.status });
      } else {
        results.push({ orderId: row.orderId, wompiTxId: row.wompiTxId, applied: false, status: tx.status });
      }
    } catch (err) {
      results.push({ orderId: row.orderId, wompiTxId: row.wompiTxId, applied: false, error: String(err) });
    }
  }
  res.json({ reconciled, results });
});

router.get("/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;