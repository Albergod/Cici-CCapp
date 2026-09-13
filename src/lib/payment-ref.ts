// Parsea la referencia externa que codifica qué se vendió.
// Formato tienda: "${storeId}_${plan}_${cycle}" (ej: 5a26…-c870_PRO_MONTHLY).
// Formato usuario (pago ANTES de crear la tienda): "USER_${userId}_${plan}_${cycle}".
// Lo usan tanto Mercado Pago como Wompi/Nequi para saber a quién corresponde
// cada pago aprobado.
export type ParsedPaymentRef =
  | { storeId: string; plan: "PRO" | "BUSINESS"; cycle: "MONTHLY" | "BI_MONTHLY" }
  | { userId: string; plan: "PRO" | "BUSINESS"; cycle: "MONTHLY" | "BI_MONTHLY" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseExternalRef(ref: string): ParsedPaymentRef | null {
  const store = ref.match(new RegExp(`^(${UUID})_(PRO|BUSINESS)_(MONTHLY|BI_MONTHLY)$`, "i"));
  if (store) {
    return {
      storeId: store[1],
      plan: store[2].toUpperCase() as "PRO" | "BUSINESS",
      cycle: store[3].toUpperCase() as "MONTHLY" | "BI_MONTHLY",
    };
  }
  const user = ref.match(new RegExp(`^USER_(${UUID})_(PRO|BUSINESS)_(MONTHLY|BI_MONTHLY)$`, "i"));
  if (user) {
    return {
      userId: user[1],
      plan: user[2].toUpperCase() as "PRO" | "BUSINESS",
      cycle: user[3].toUpperCase() as "MONTHLY" | "BI_MONTHLY",
    };
  }
  return null;
}