// Lógica de negocio de suscripciones y periodo de prueba.
// Modelo de negocio: "centro comercial digital".
// - Cada creador abre su tienda (local).
// - El contacto directo con clientes (chat) está disponible durante el
//   periodo de prueba gratuita y, después, solo con suscripción de espacio.

// Periodo de prueba: 2 meses y 15 días = 75 días de prueba gratis.
export const TRIAL_DURATION_MS =
  45 * 24 * 60 * 60 * 1000 + // 45 días
  30 * 24 * 60 * 60 * 1000; // 30 días => 75 días en total

export type SubscriptionStatus = "trial" | "active" | "expired";

export interface ContactEligibility {
  /** true si el cliente/creador puede usar el contacto directo */
  contactAvailable: boolean;
  status: SubscriptionStatus;
  /** fecha (ms) en que finaliza la prueba gratis o null si ya pasó */
  trialEndsAt?: number;
  /** indica si aún disfruta de la prueba gratuita */
  onTrial: boolean;
  /** indica si tiene una suscripción de espacio vigente */
  subscribed: boolean;
}

/**
 * Evalúa si una tienda puede ofrecer contacto directo (chat) con clientes.
 *
 * La tienda recibe el contacto habilitado:
 *  1. Durante el período de prueba gratuita (TRIAL_DURATION_MS desde trialStartedAt), o
 *  2. Mientras haya una suscripción de espacio vigente (subscriptionExpiresAt > now).
 */
export function getContactEligibility(
  trialStartedAt: Date | string | null | undefined,
  subscriptionExpiresAt: Date | string | null | undefined,
): ContactEligibility {
  const now = Date.now();

  const trialStart = trialStartedAt ? new Date(trialStartedAt).getTime() : now;
  const trialEnd = trialStart + TRIAL_DURATION_MS;
  const onTrial = now < trialEnd;

  const subExpiry = subscriptionExpiresAt
    ? new Date(subscriptionExpiresAt).getTime()
    : null;
  const subscribed = subExpiry !== null && subExpiry > now;

  const status: SubscriptionStatus = subscribed
    ? "active"
    : onTrial
      ? "trial"
      : "expired";

  const contactAvailable = onTrial || subscribed;

  return {
    contactAvailable,
    status,
    trialEndsAt: onTrial ? trialEnd : undefined,
    onTrial,
    subscribed,
  };
}