import { norm } from "./text";

export interface CatalogMatch {
  name: string;
  index: number; // posición en el texto normalizado
  score: number; // 0..1
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findVariant(text: string, variant: string): number {
  const re = new RegExp(`(^|[^a-z0-9])${esc(variant)}(?![a-z0-9])`, "");
  const mt = re.exec(text);
  if (mt) return mt.index + mt[1].length;
  return -1;
}

/**
 * Busca TODOS los ítems del catálogo mencionados en el mensaje (singular y
 * plural), ordenados por posición. Devuelve el nombre original de la DB, no el
 * match "normalizado". También acepta la primera palabra significativa ("corte"
 * → "Corte de pelo") cuando es única en el catálogo.
 */
export function findAllMatches(message: string, catalog: { name: string }[]): CatalogMatch[] {
  const msg = norm(message);
  const wordCounts = new Map<string, number>();
  for (const item of catalog) {
    const w = firstWord(norm(item.name));
    if (w) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
  }
  const found: CatalogMatch[] = [];
  for (const item of catalog) {
    const name = norm(item.name);
    if (!name) continue;
    const variants = name.length > 3 ? [name, `${name}s`, name.replace(/s$/, "")] : [name];
    let index = findAnyVariant(msg, variants);
    if (index < 0) {
      const w = firstWord(name);
      if (w && wordCounts.get(w) === 1) index = findVariant(msg, w);
    }
    if (index >= 0) found.push({ name: item.name, index, score: name.length >= 4 ? 1 : 0.9 });
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

function firstWord(name: string): string | undefined {
  const m = /^[a-z0-9]{4,}/.exec(name);
  return m ? m[0] : undefined;
}

function findAnyVariant(text: string, variants: string[]): number {
  for (const v of variants) {
    const index = findVariant(text, v);
    if (index >= 0) return index;
  }
  return -1;
}

export function bestMatch(message: string, catalog: { name: string }[]): CatalogMatch | null {
  return findAllMatches(message, catalog)[0] ?? null;
}

/**
 * Cantidad que precede al ítem en el mensaje normalizado ("2 hamburguesas",
 * "2 x hamburguesa"). Si no hay número, asume 1. Rango válido 1..99.
 */
export function quantityBefore(normalizedMatchIndex: number, normalizedMessage: string): number {
  const before = normalizedMessage.slice(0, normalizedMatchIndex).trim();
  const xmatch = /(\d{1,3})\s*x\s*$/.exec(before);
  if (xmatch) return clampQty(Number(xmatch[1]));
  const m = /(?:^|\s)(\d{1,3})\s*$/.exec(before);
  if (m) return clampQty(Number(m[1]));
  return 1;
}

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, Math.floor(n)));
}