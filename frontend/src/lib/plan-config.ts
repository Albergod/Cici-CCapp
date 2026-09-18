// Copia sincronizada con src/lib/plan-config.ts del backend.
// Mantener ambos en mismos valores para consistencia visual.

// Fin del Early Access (precios promocionales). Must match backend.
// Se puede sobreescribir por entorno (VITE_EARLY_ACCESS_ENDS_AT, ISO 8601);
// si no está, usa el respaldo (13-nov-2026). Define VITE_EARLY_ACCESS_ENDS_AT
// el día del lanzamiento (fecha de lanzamiento + 60 días) para que el
// countdown se ancle ahí.
const DEFAULT_EARLY_ACCESS_ENDS_AT = new Date("2026-11-13T23:59:59-05:00").getTime();

function parseEndsAt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : fallback;
}

export const EARLY_ACCESS_ENDS_AT = parseEndsAt(
  import.meta.env.VITE_EARLY_ACCESS_ENDS_AT as string | undefined,
  DEFAULT_EARLY_ACCESS_ENDS_AT,
);

export const PLAN_PRICES_COP: Record<
  "MONTHLY" | "BI_MONTHLY",
  { amount: number; label: string; savings: string | null }
> = {
  MONTHLY: { amount: 20_000, label: "$20.000 /mes", savings: "$10.000" },
  BI_MONTHLY: { amount: 30_000, label: "$30.000 /2 meses", savings: "$10.000" },
};

// Precios regulares (cuando termine el Early Access). Mirrors backend.
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
    { title: "Asistente IA que vende por ti", description: "Atiende a tus clientes y cierra la venta por WhatsApp." },
    { title: "Pedidos automáticos", description: "La IA anota los pedidos y descuenta el stock al confirmarlos." },
    { title: "Sistema de prestigio y referidos", description: "Gana puntos citando a otros emprendedores." },
    { title: "Check verificado", description: "Al llegar a 100 puntos obtienes el check oficial." },
    { title: "Hasta 100 productos", description: "Publica hasta 100 productos de tu catálogo." },
  ],
  BUSINESS: [
    { title: "Todo lo del plan Premium", description: "Incluye asistente IA, pedidos automáticos, prestigio, referidos y check verificado." },
    { title: "Hasta 500 productos", description: "El mayor espacio del centro comercial." },
    { title: "Máxima visibilidad", description: "Tu local aparece primero en el feed." },
  ],
};

/** true mientras el Early Access esté vigente (hoy < fecha de fin). */
export function isEarlyAccess(now: number = Date.now()): boolean {
  return now < EARLY_ACCESS_ENDS_AT;
}

// Obtiene el precio vigente (promo durante el Early Access, regular después).
// Misma lógica que el backend: display y cobro nunca se descuadran.
export function getActivePrices(now?: number) {
  return isEarlyAccess(now ?? Date.now()) ? PLAN_PRICES_COP : PLAN_PRICES_REGULAR;
}