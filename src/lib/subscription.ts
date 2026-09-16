// Lógica de negocio de suscripciones y periodo de prueba.
// Modelo de negocio: "centro comercial digital".
// - Cada creador abre su tienda (local).
// - El trial NO arranca al crear la tienda: la tienda nace FREE y el
//   comerciante activa la prueba (POST /stores/:id/trial, una sola vez por
//   propietario) cuando ya tiene algo que probar. El marcador de prueba es
//   `plan != FREE` + `subscriptionCycle = null`, vs un pago real que siempre
//   fija MONTHLY/BI_MONTHLY. El "Día 14 → ¿Quieres continuar?" lo resuelve el
//   cron de expiración: baja la tienda a FREE y queda en modo manual (sin IA).
// - El contacto directo con clientes (chat) está SIEMPRE disponible: quien
//   prueba la app necesita experimentar su valor para luego pagar por el
//   espacio, el sistema de prestigio/referidos y los límites ampliados.

// Periodo de prueba PRO: 14 días.
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * true si la tienda está en prueba PRO (plan de pago SIN ciclo: un pago real
 * siempre configura subscription_cycle). Las tiendas FREE y las pagadas de
 * verdad devuelven false.
 */
export function isOnTrial(store: {
  plan?: string | null;
  subscriptionCycle?: string | null;
}): boolean {
  return (
    !!store.plan &&
    store.plan !== "FREE" &&
    (store.subscriptionCycle === null || store.subscriptionCycle === undefined)
  );
}

export type SubscriptionStatus = "trial" | "active" | "free" | "expired";

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
  plan?: string | null,
  subscriptionCycle?: string | null,
): ContactEligibility {
  const now = Date.now();

  const trialStart = trialStartedAt ? new Date(trialStartedAt).getTime() : now;
  const trialEnd = trialStart + TRIAL_DURATION_MS;

  // En prueba (plan de pago SIN ciclo, dentro de los 14 días): sigue siendo
  // trial aunque subscriptionExpiresAt esté en el futuro.
  const onTrialWindow =
    !!plan && plan !== "FREE" && (subscriptionCycle === null || subscriptionCycle === undefined) && now < trialEnd;

  const subExpiry = subscriptionExpiresAt
    ? new Date(subscriptionExpiresAt).getTime()
    : null;

  // Suscripción REAL: un pago de verdad siempre fija el ciclo. Un plan de pago
  // sin fecha de expiración (NULL) se trata como vigente (espacios
  // administrados).
  const subscribed =
    !!plan &&
    plan !== "FREE" &&
    subscriptionCycle !== null &&
    subscriptionCycle !== undefined &&
    (subExpiry === null || subExpiry > now);

  // La tienda nunca activó la prueba (recién creada, FREE sin trial): estado
  // "free". Una tienda que YA la usó (trial o plan vencido) va a "expired".
  const expired =
    (subExpiry !== null && subExpiry <= now) ||
    (plan === "FREE" &&
      subscriptionCycle === null &&
      subscriptionExpiresAt === null &&
      !!trialStartedAt);

  const status: SubscriptionStatus = subscribed
    ? "active"
    : onTrialWindow
      ? "trial"
      : expired
        ? "expired"
        : plan === "FREE"
          ? "free"
          : "expired";

  // El contacto nunca se bloquea.
  const contactAvailable = true;

  return {
    contactAvailable,
    status,
    trialEndsAt: onTrialWindow ? trialEnd : undefined,
    onTrial: onTrialWindow,
    subscribed,
  };
}