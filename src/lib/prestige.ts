// Lógica del sistema de prestigio.
// - Los emprendedores ganan puntos de prestigio al invitar a más personas
//   (referidos) que abran su propia tienda.
// - Al llegar a VP_VERIFIED_THRESHOLD puntos, la tienda obtiene el "chulito"
//   de verificado (como en X/Twitter).

export const VERIFIED_THRESHOLD = 100;

/** Puntos de prestigio que se otorgan por cada referido que abre una tienda. */
export const PRESTIGE_PER_REFERRAL = 25;

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
