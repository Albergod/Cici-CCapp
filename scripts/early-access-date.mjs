#!/usr/bin/env node
// Imprime la fecha de fin del Early Access (hoy + N días, por defecto 60)
// en formato ISO para copiar y pegar directamente en las env vars de Render.
//
// Uso:
//   node scripts/early-access-date.mjs        → hoy + 60d (default)
//   node scripts/early-access-date.mjs 90     → hoy + 90d
//   node scripts/early-access-date.mjs --help

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Uso: node scripts/early-access-date.mjs [días]");
  console.log("  Sin argumentos: hoy + 60 días.");
  process.exit(0);
}

const days = parseInt(args[0], 10);
const target = isNaN(days) ? 60 : Math.max(1, days);

const now = new Date();
const end = new Date(now);
end.setDate(end.getDate() + target);
// Fijar a 23:59:59 con offset de Colombia (-05:00) para consistencia.
const iso = end.toISOString().split("T")[0] + "T23:59:59-05:00";

console.log(`\nEarly Access: hoy + ${target} días`);
console.log(`\nCopia esto en EARLY_ACCESS_ENDS_AT y VITE_EARLY_ACCESS_ENDS_AT en Render:`);
console.log(`\n  ${iso}\n`);
