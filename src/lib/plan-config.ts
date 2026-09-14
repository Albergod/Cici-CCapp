// Configuración del plan y precios. Un solo lugar para cambiar los valores
// del espacio de pago (PREMIUM = PRO, pero el monto depende del ciclo).
// Todos los componentes/backend importan desde aquí → DRY y sin inconsistencias.

// Early Access: precios promocionales por TIEMPO (no manual). Al pasar
// EARLY_ACCESS_ENDS_AT, getActivePrices() devuelve los precios regulares solos
// (backend y frontend usan el mismo cálculo → cobro y display nunca descuadran).
//
// La fecha se lee de la variable de entorno EARLY_ACCESS_ENDS_AT (ISO 8601).
// Si no está configurada, usa el respaldo (13-nov-2026). Tip: defínela en
// Render el DÍA del lanzamiento con "fecha de lanzamiento + 60 días" para que
// el contador se ancle ahí y no dependa de cuándo se hizo el deploy.
const DEFAULT_EARLY_ACCESS_ENDS_AT = new Date("2026-11-13T23:59:59-05:00").getTime();

function parseEndsAt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : fallback;
}

export const EARLY_ACCESS_ENDS_AT = parseEndsAt(
  process.env.EARLY_ACCESS_ENDS_AT,
  DEFAULT_EARLY_ACCESS_ENDS_AT,
);

export const PLAN_PRICES_COP: Record<
  "MONTHLY" | "BI_MONTHLY",
  { amount: number; label: string; savings: string | null }
> = {
  MONTHLY: { amount: 20_000, label: "$20.000 /mes", savings: "$10.000" },
  BI_MONTHLY: { amount: 30_000, label: "$30.000 /2 meses", savings: "$10.000" },
};

// Precios regulares (a aplicar cuando termine el Early Access).
export const PLAN_PRICES_REGULAR: Record<
  "MONTHLY" | "BI_MONTHLY",
  { amount: number; label: string; savings: string | null }
> = {
  MONTHLY: { amount: 30_000, label: "$30.000 /mes", savings: null },
  BI_MONTHLY: { amount: 55_000, label: "$55.000 /2 meses", savings: "$5.000" },
};

export const PLAN_FEATURES: Record<
  "PRO" | "BUSINESS",
  { title: string; description: string }[]
> = {
  PRO: [
    { title: "Sistema de prestigio y referidos", description: "Gana puntos citando a otros emprendedores." },
    { title: "Check verificado", description: "Al llegar a 100 puntos obtienes el check oficial." },
    { title: "Hasta 100 productos", description: "Publica tu catálogo completo." },
    { title: "Métricas de ventas", description: "Tasa de conversión y estadísticas detalladas." },
  ],
  BUSINESS: [
    { title: "Todo lo del plan Premium+", description: "Sin límite de productos." },
    { title: "Hasta 500 productos", description: "El mayor espacio del centro comercial." },
    { title: "Máxima visibilidad", description: "Tu local aparece primero en el feed." },
  ],
};

/** true mientras el Early Access esté vigente (hoy < fecha de fin). */
export function isEarlyAccess(now: number = Date.now()): boolean {
  return now < EARLY_ACCESS_ENDS_AT;
}

// Obtiene el precio vigente (promo durante el Early Access, regular después).
export function getActivePrices(now?: number) {
  return isEarlyAccess(now ?? Date.now()) ? PLAN_PRICES_COP : PLAN_PRICES_REGULAR;
}