import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { stores } from "../db/schema";
import { getActivePrices } from "./plan-config";
import { PRESTIGE_GOAL_STEP, PRESTIGE_GOAL_MAX, PRESTIGE_BASE_GOAL } from "./prestige";

export { getActivePrices };

export const CYCLE_MS: Record<"MONTHLY" | "BI_MONTHLY", number> = {
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
  BI_MONTHLY: 60 * 24 * 60 * 60 * 1000,
};

export function priceFor(plan: "PRO" | "BUSINESS", cycle: "MONTHLY" | "BI_MONTHLY"): number {
  return getActivePrices()[cycle].amount;
}

export function generateReferralCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Devuelve el código de referido de una tienda generándolo (único) y
 * persistiéndolo si aún no tiene. Evita enlaces `?ref=null` aunque la tienda
 * haya quedado con plan activo sin pasar por activatePaidPlan.
 */
export async function ensureReferralCode(storeId: string, current?: string | null): Promise<string> {
  if (current) return current;
  let referralCode = generateReferralCode();
  let exists = true;
  while (exists) {
    const dup = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.referralCode, referralCode))
      .limit(1);
    exists = dup.length > 0;
    if (exists) referralCode = generateReferralCode();
  }
  await db.update(stores).set({ referralCode }).where(eq(stores.id, storeId));
  return referralCode;
}

/**
 * Activa el plan de pago de una tienda. SOLO debe llamarse cuando el pago fue
 * confirmado como aprobado contra Mercado Pago (webhook o verificación), de
 * modo que nunca se conceda PRO/BUSINESS sin un pago real.
 */
export async function activatePaidPlan(
  storeId: string,
  plan: "PRO" | "BUSINESS",
  cycle: "MONTHLY" | "BI_MONTHLY",
): Promise<{ alreadyActive: boolean }> {
  const [store] = await db
    .select()
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) throw new Error("Tienda no encontrada");

  const alreadyActive =
    (store.plan === plan && store.subscriptionCycle === cycle) ||
    (store.plan !== "FREE" &&
      store.subscriptionCycle !== null &&
      store.subscriptionExpiresAt !== null &&
      new Date(store.subscriptionExpiresAt).getTime() > Date.now());

  const referralCode = await ensureReferralCode(storeId, store.referralCode);

  // Meta de prestigio (puntos que hacen falta para el check):
  //  - Primera activación → base 100. Una tienda nueva NO arranca en 200.
  //  - Renovación del plan en curso y upgrade de plan → +100 (tope 1000).
  // Una tienda que ya pagó antes (aunque esté vencida y hoy sea FREE) cuenta
  // como renovación, no como primera activación: lo delata su código de
  // referido, que solo se genera al activar un plan de pago real.
  const currentGoal = Number(store.prestigeGoal) || PRESTIGE_BASE_GOAL;
  const hadPaidPlan =
    store.plan !== "FREE" || store.subscriptionCycle !== null || store.referralCode != null;
  const nextGoal = hadPaidPlan
    ? Math.min(PRESTIGE_GOAL_MAX, currentGoal + PRESTIGE_GOAL_STEP)
    : PRESTIGE_BASE_GOAL;

  await db
    .update(stores)
    .set({
      plan,
      subscriptionCycle: cycle,
      subscriptionExpiresAt: new Date(
        Math.max(Date.now(), store.subscriptionExpiresAt?.getTime() ?? 0) + CYCLE_MS[cycle],
      ),
      referralCode,
      prestigeGoal: nextGoal,
    })
    .where(eq(stores.id, storeId));

  return { alreadyActive };
}