// Ofertas estilo Shopee (v1): precio promo + fecha fin por producto.
//
// - Sin oferta: offerPrice/offerEndsAt son NULL y todo sigue igual.
// - La vigencia se evalúa al LEER (sin cron): vencida = se ignora y el precio
//   vuelve solo al base.
// - El público nunca ve stock; solo precio efectivo + flags.

export interface OfferInput {
  price: string | number;
  offerPrice?: string | number | null;
  offerEndsAt?: string | Date | null;
}

export interface OfferFlags {
  /** Precio que paga el cliente hoy (promo si hay oferta vigente). */
  effectivePrice: number;
  onOffer: boolean;
  /** % de descuento redondeado (0 si no hay oferta). */
  discountPct: number;
  /** ISO de fin de oferta o null. */
  offerEndsAt: string | null;
}

export function offerActive(offerPrice: string | number | null | undefined, offerEndsAt: string | Date | null | undefined, now = Date.now()): boolean {
  const promo = Number(offerPrice ?? NaN);
  if (!Number.isFinite(promo) || promo <= 0) return false;
  if (offerEndsAt == null) return false;
  const ends = new Date(offerEndsAt).getTime();
  if (!Number.isFinite(ends) || ends <= now) return false;
  return true;
}

export function withOfferFlags<T extends OfferInput>(row: T, now = Date.now()): T & OfferFlags {
  const base = Number(row.price) || 0;
  const active = offerActive(row.offerPrice, row.offerEndsAt, now);
  const promo = Number(row.offerPrice ?? NaN);
  const validPromo = active && promo > 0 && promo < base;
  const discountPct = validPromo ? Math.round((1 - promo / base) * 100) : 0;
  const ends = row.offerEndsAt ? new Date(row.offerEndsAt) : null;
  return {
    ...row,
    effectivePrice: validPromo ? promo : base,
    onOffer: validPromo,
    discountPct,
    offerEndsAt: ends && Number.isFinite(ends.getTime()) ? ends.toISOString() : null,
  };
}

/** Máximo de días que puede durar una oferta (evita "ofertas eternas"). */
export const OFFER_MAX_DAYS = 30;

/**
 * Disponibilidad pública sin filtrar cantidades: true si está disponible y
 * (cuando el stock viene) es mayor a 0. Si el stock no viene (payload
 * público, que nunca lo expone), se confía en `available`.
 */
export function computeInStock(row: { available?: boolean | null; stock?: string | number | null }): boolean {
  if (row.available === false) return false;
  if (row.stock == null || row.stock === "") return true;
  const n = Number(row.stock);
  return Number.isFinite(n) ? n > 0 : true;
}

/**
 * Valida y normaliza una oferta contra el precio base. Devuelve los campos
 * listos para DB, `null`s para quitarla, o un mensaje de error.
 */
export function validateOffer(
  basePrice: number,
  rawPromo: unknown,
  rawEnds: unknown,
): { fields: { offerPrice: string | null; offerEndsAt: Date | null } } | { error: string } {
  const promo = rawPromo == null || rawPromo === "" ? null : Number(rawPromo);
  if (promo == null || !(promo > 0)) {
    return { fields: { offerPrice: null, offerEndsAt: null } };
  }
  if (!Number.isFinite(promo) || promo >= basePrice) {
    return { error: "El precio de oferta debe ser menor al precio normal." };
  }
  const ends = rawEnds ? new Date(String(rawEnds)) : null;
  if (!ends || !Number.isFinite(ends.getTime()) || ends.getTime() <= Date.now()) {
    return { error: "La oferta necesita una fecha de fin futura." };
  }
  if (ends.getTime() > Date.now() + OFFER_MAX_DAYS * 86_400_000) {
    return { error: `La oferta puede durar máximo ${OFFER_MAX_DAYS} días.` };
  }
  return { fields: { offerPrice: promo.toFixed(2), offerEndsAt: ends } };
}

/** Campos de oferta para INSERT (solo si son válidos; si no, sin oferta). */
export function buildOfferFields(
  basePrice: number,
  rawPromo: unknown,
  rawEnds: unknown,
): { offerPrice?: string | null; offerEndsAt?: Date | null } {
  if (rawPromo == null) return {};
  const result = validateOffer(basePrice, rawPromo, rawEnds);
  if ("error" in result) return {};
  return result.fields;
}
