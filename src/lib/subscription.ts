// Lógica de negocio de suscripciones y periodo de prueba.
// Modelo de negocio: "centro comercial digital".
// - Cada creador abre su tienda (local).
// - El contacto directo con clientes (chat) está SIEMPRE disponible: quien prueba
//   la app necesita experimentar su valor para luego pagar por el espacio y el
//   sistema de prestigio/referidos. La suscripción de pago otorga prestigio,
//   referidos, más productos y permanencia del local.

// Periodo de prueba del plan gratis: 30 días.
export const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type SubscriptionStatus = "trial" | "active" | "expired";

export interface ContactEligibility {
  /** true si el cliente/creador puede usar el contacto directo. Siempre disponible. */
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
 * Evalúa la suscripción de una tienda.
 *
 * El contacto con clientes SIEMPRE está habilitado (no es el muro de pago).
 * El estado de suscripción se mantiene para propósitos informativos y para
 * activar los servicios premium del plan de pago (prestigio/referidos).
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

  // El contacto nunca se bloquea.
  const contactAvailable = true;

  return {
    contactAvailable,
    status,
    trialEndsAt: onTrial ? trialEnd : undefined,
    onTrial,
    subscribed,
  };
}