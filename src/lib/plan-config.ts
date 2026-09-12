// Configuración del plan y precios. Un solo lugar para cambiar los valores
// del espacio de pago (PREMIUM = PRO, pero el monto depende del ciclo).
// Todos los componentes/backend importan desde aquí → DRY y sin inconsistencias.

// Early Access: 30 días con precios promocionales.
// Después de esta ventana, cambiar estos valores a precios regulares
// ($30.000/mes y $55.000/bimensual).
export const EARLY_ACCESS = true;
export const EARLY_ACCESS_DAYS = 30;

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

// Obtiene el precio vigente (early access o regular).
export function getActivePrices() {
  return EARLY_ACCESS ? PLAN_PRICES_COP : PLAN_PRICES_REGULAR;
}