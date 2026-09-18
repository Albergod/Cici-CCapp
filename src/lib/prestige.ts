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
 * renovaciones/reactivaciones.
 * La bandera SOLO se marca cuando el premio realmente se otorga: si el
 * referidor no califica todavía (plan FREE o trial), no se quema la bandera
 * y el pago queda "pendiente" hasta que el referidor tenga un plan de pago
 * activo (reinicio del plan → se reintenta y premia).
 * Suma PRESTIGE_PER_REFERRAL y REFERRAL_BONUS_DAYS a la vigencia del plan.
 * Un referidor en modo trial (plan != FREE pero subscription_cycle = null) tampoco
 * premia: los días de regalo y los puntos solo aplican a un plan REAL pagado.
 * Devuelve los puntos otorgados (0 si no aplicó).
 */
export async function awardReferralPrestige(referredStoreId: string): Promise<number> {
  // Fase 1 (solo lectura): NO se toca la bandera aún. Si el referidor no es
  // elegible en este momento (plan FREE/trial), el premio queda pendiente:
  // cuando reactive su plan se reintentará y el referido seguirá sin marcar.
  const [referred] = await db
    .select()
    .from(stores)
    .where(eq(stores.id, referredStoreId))
    .limit(1);
  if (!referred?.referredByStoreId) return 0;
  if (referred.referralRewarded) return 0;

  const [referrer] = await db
    .select({ id: stores.id, plan: stores.plan, subscriptionCycle: stores.subscriptionCycle })
    .from(stores)
    .where(eq(stores.id, referred.referredByStoreId))
    .limit(1);
  if (
    !referrer ||
    referrer.plan === "FREE" ||
    referrer.subscriptionCycle === null ||
    referrer.subscriptionCycle === undefined
  ) {
    return 0;
  }

  // Fase 2: guarda atómica contra dobles premios (renovaciones/reactivaciones).
  const [claimed] = await db
    .update(stores)
    .set({ referralRewarded: true })
    .where(and(eq(stores.id, referredStoreId), eq(stores.referralRewarded, false)))
    .returning({ id: stores.id });
  if (!claimed) return 0;

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
