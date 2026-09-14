// Configuración del plan y precios. Un solo lugar para cambiar los valores
// del espacio de pago (PREMIUM = PRO, pero el monto depende del ciclo).
// Todos los componentes/backend importan desde aquí → DRY y sin inconsistencias.

// Early Access: 60 días desde el lanzamiento con precios promocionales.
// El cambio a precios regulares ($30.000/mes y $55.000/bimensual) es por
// TIEMPO y automático: al pasar EARLY_ACCESS_ENDS_AT, getActivePrices()
// devuelve los precios regulares solos (backend y frontend usan el mismo
// cálculo, así que cobro y display nunca se descuadran).
export const EARLY_ACCESS_ENDS_AT = new Date("2026-11-13T23:59:59-05:00").getTime();

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