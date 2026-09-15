// Lógica del sistema de prestigio.
// - Los emprendedores ganan puntos de prestigio al invitar a más personas
//   (referidos) que abran su propia tienda.
// - Al llegar a VP_VERIFIED_THRESHOLD puntos, la tienda obtiene el "chulito"
//   de verificado (como en X/Twitter).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { stores } from "../db/schema";

export const VERIFIED_THRESHOLD = 100;

/** Base de la meta de prestigio (100). La meta sube con los upgrades propios. */
export const PRESTIGE_BASE_GOAL = 100;

/** Cuánto sube la meta cada vez que el comerciante activa/renueva/mejora su plan. */
export const PRESTIGE_GOAL_STEP = 100;

/** Tope de la meta de prestigio. */
export const PRESTIGE_GOAL_MAX = 1000;

/**
 * Puntos de prestigio que se otorgan por cada referido que paga su plan.
 * Un referido que crea su tienda FREE y nunca paga no genera prestigio.
 * (La "meta" del check la maneja el frontend como una barra que crece con
 * los upgrades; aquí no se inflan puntos por upgrade.)
 */
export const PRESTIGE_PER_REFERRAL = 25;

/** Días de plan que suma a su suscripción el referidor por cada referido pago. */
export const REFERRAL_BONUS_DAYS = 3;

/** Códigos cortos para el plan (límites) relacionados con productos. */
export const PRODUCT_LIMITS: Record<string, number> = {
  FREE: 20,
  PRO: 100,
  BUSINESS: 500,
};

export type PrestigeStatus = "unverified" | "verified";

export function computePrestigeStatus(prestigePoints: number): PrestigeStatus {
  return prestigePoints >= VERIFIED_THRESHOLD ? "verified" : "unverified";
}

export function getProductLimit(plan: string | null | undefined): number {
  return PRODUCT_LIMITS[plan ?? "FREE"] ?? PRODUCT_LIMITS.FREE;
}

/**
 * Otorga el premio de referido al referidor cuando la tienda del referido
 * ACTIVA un plan de pago. Es idempotente (una vez por referido): la bandera
 * referral_rewarded actúa como guarda atómica contra dobles premios en
 * renovaciones/reactivaciones. El referidor debe tener un plan de pago activo.
 * Suma PRESTIGE_PER_REFERRAL y REFERRAL_BONUS_DAYS a la vigencia del plan.
 * Devuelve los puntos otorgados (0 si no aplicó).
 */
export async function awardReferralPrestige(referredStoreId: string): Promise<number> {
  const [claimed] = await db
    .update(stores)
    .set({ referralRewarded: true })
    .where(and(eq(stores.id, referredStoreId), eq(stores.referralRewarded, false)))
    .returning({ referredByStoreId: stores.referredByStoreId });
  if (!claimed?.referredByStoreId) return 0;

  const [referrer] = await db
    .select({ id: stores.id, plan: stores.plan })
    .from(stores)
    .where(eq(stores.id, claimed.referredByStoreId))
    .limit(1);
  if (!referrer || referrer.plan === "FREE") return 0;

  await db
    .update(stores)
    .set({ prestigePoints: sql`${stores.prestigePoints} + ${PRESTIGE_PER_REFERRAL}` })
    .where(eq(stores.id, referrer.id));
  await db.execute(
    sql`UPDATE stores SET subscription_expires_at =
      COALESCE(subscription_expires_at, now()) + interval '${sql.raw(String(REFERRAL_BONUS_DAYS))} days'
      WHERE id = ${referrer.id}`,
  );
  return PRESTIGE_PER_REFERRAL;
}
