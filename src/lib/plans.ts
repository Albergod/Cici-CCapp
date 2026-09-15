import { and, eq, sql } from "drizzle-orm";
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

function generateReferralCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
    (store.plan !== "FREE" && store.subscriptionExpiresAt !== null &&
      new Date(store.subscriptionExpiresAt).getTime() > Date.now());

  let referralCode = store.referralCode;
  if (!referralCode) {
    referralCode = generateReferralCode();
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
  }

  await db
    .update(stores)
    .set({
      plan,
      subscriptionCycle: cycle,
      subscriptionExpiresAt: new Date(
        Math.max(Date.now(), store.subscriptionExpiresAt?.getTime() ?? 0) + CYCLE_MS[cycle],
      ),
      referralCode,
      // Cada activación/renovación/mejora del propietario sube su META de
      // prestigio (+100, tope 1000). No toca los puntos ya ganados.
      prestigeGoal: sql`LEAST(
        ${PRESTIGE_GOAL_MAX},
        COALESCE(${stores.prestigeGoal}, ${PRESTIGE_BASE_GOAL}) + ${PRESTIGE_GOAL_STEP}
      )`,
    })
    .where(eq(stores.id, storeId));

  return { alreadyActive };
}