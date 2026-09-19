/** Normaliza texto: minúsculas, sin acentos ni puntuación, espacios simples. */
export function norm(s: string): string {
  return s
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}