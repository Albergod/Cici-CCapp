export function formatCOP(n: number | string | null | undefined): string {
  const value = Number(n);
  if (Number.isNaN(value)) return '$0';
  return '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
}