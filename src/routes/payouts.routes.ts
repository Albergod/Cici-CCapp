// Cici Payments: cuentas bancarias y liquidaciones.
//
// Solo la dueña de la tienda (en el piloto, el operador de Cici) gestiona
// cuentas y solicita/confirma desembolsos. El número de cuenta se cifra en
// reposo y nunca se devuelve completo por la API.
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { merchantBankAccounts, stores } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { canEncrypt, encryptSecret, last4 } from "../lib/crypto";
import { balanceForStore } from "../lib/ledger";
import { confirmPayout, failPayout, listPayouts, requestPayout } from "../lib/payouts";

const router = Router();
router.use(requireAuth);

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownerStore(userId: string) {
  const [store] = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(eq(stores.ownerId, userId))
    .limit(1);
  return store ?? null;
}

const bankSchema = z.object({
  bankCode: z.string().trim().min(1).max(20),
  bankName: z.string().trim().max(80).optional(),
  accountType: z.enum(["AHORROS", "CORRIENTE"]),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Número de cuenta inválido."),
  holderName: z.string().trim().min(3).max(120),
  holderDocType: z.enum(["CC", "CE", "NIT", "PP"]).optional(),
  holderDoc: z.string().trim().regex(/^\d{5,15}$/).optional(),
  isDefault: z.boolean().optional(),
});

/** Datos seguros para mostrar: sin número completo ni documento cifrado. */
function publicAccount(row: typeof merchantBankAccounts.$inferSelect) {
  return {
    id: row.id,
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountType: row.accountType,
    accountLast4: row.accountLast4,
    holderName: row.holderName,
    holderDocType: row.holderDocType,
    verificationStatus: row.verificationStatus,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}

// GET /api/payouts/bank-accounts
router.get("/bank-accounts", async (req: AuthRequest, res) => {
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const rows = await db
    .select()
    .from(merchantBankAccounts)
    .where(eq(merchantBankAccounts.storeId, store.id))
    .orderBy(desc(merchantBankAccounts.isDefault), desc(merchantBankAccounts.createdAt));
  res.json(rows.map(publicAccount));
});

// POST /api/payouts/bank-accounts
router.post("/bank-accounts", async (req: AuthRequest, res) => {
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  if (!canEncrypt()) {
    return res.status(503).json({ error: "Falta configurar el cifrado de datos bancarios." });
  }
  const parsed = bankSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos bancarios inválidos.", detail: parsed.error.flatten() });
  }
  const data = parsed.data;

  const row = await db.transaction(async (trx) => {
    const existing = await trx
      .select({ id: merchantBankAccounts.id })
      .from(merchantBankAccounts)
      .where(eq(merchantBankAccounts.storeId, store.id));
    const makeDefault = data.isDefault === true || existing.length === 0;
    if (makeDefault) {
      await trx
        .update(merchantBankAccounts)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(merchantBankAccounts.storeId, store.id));
    }
    const [created] = await trx
      .insert(merchantBankAccounts)
      .values({
        storeId: store.id,
        bankCode: data.bankCode,
        bankName: data.bankName ?? null,
        accountType: data.accountType,
        encryptedAccountNumber: encryptSecret(data.accountNumber),
        accountLast4: last4(data.accountNumber),
        holderName: data.holderName,
        holderDocType: data.holderDocType ?? null,
        encryptedHolderDoc: data.holderDoc ? encryptSecret(data.holderDoc) : null,
        isDefault: makeDefault,
      })
      .returning();
    return created;
  });

  res.status(201).json(publicAccount(row));
});

// DELETE /api/payouts/bank-accounts/:id
router.delete("/bank-accounts/:id", async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const [deleted] = await db
    .delete(merchantBankAccounts)
    .where(
      and(
        eq(merchantBankAccounts.id, req.params.id),
        eq(merchantBankAccounts.storeId, store.id),
      ),
    )
    .returning({ id: merchantBankAccounts.id });
  if (!deleted) return res.status(404).json({ error: "Cuenta no encontrada." });
  res.json({ ok: true });
});

// GET /api/payouts/balance — saldo reconstruido desde el ledger.
router.get("/balance", async (req: AuthRequest, res) => {
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  res.json(await balanceForStore(store.id));
});

// GET /api/payouts — historial de liquidaciones.
router.get("/", async (req: AuthRequest, res) => {
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  res.json(await listPayouts(store.id));
});

// POST /api/payouts/request — agrupa todo el saldo disponible en un payout.
router.post("/request", async (req: AuthRequest, res) => {
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const result = await requestPayout(store.id, req.userId!);
  if (!result.ok) return res.status(result.status).json({ error: result.message, code: result.code });
  res.status(201).json({
    ...result.payout,
    alreadyExisted: result.alreadyExisted ?? false,
    note:
      "Liquidación preparada. Transfiere el monto a la cuenta registrada y confírmalo con el comprobante.",
  });
});

// POST /api/payouts/:id/mark-paid — confirma el desembolso (idempotente).
router.post("/:id/mark-paid", async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const parsed = z
    .object({ providerPayoutId: z.string().trim().max(120).optional() })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Referencia inválida." });
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const result = await confirmPayout(req.params.id, store.id, parsed.data.providerPayoutId);
  if (!result.ok) return res.status(result.status).json({ error: result.message, code: result.code });
  res.json(result.payout);
});

// POST /api/payouts/:id/fail — devuelve el saldo a disponible (sin perder dinero).
router.post("/:id/fail", async (req: AuthRequest, res) => {
  if (!UUID_RX.test(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const parsed = z
    .object({ reason: z.string().trim().min(3, "Explica el motivo.").max(300) })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Motivo inválido." });
  const store = await ownerStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const result = await failPayout(req.params.id, store.id, parsed.data.reason);
  if (!result.ok) return res.status(result.status).json({ error: result.message, code: result.code });
  res.json(result.payout);
});

export default router;
