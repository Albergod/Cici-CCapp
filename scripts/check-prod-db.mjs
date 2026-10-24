// Diagnóstico SOLO LECTURA para decidir si una base legacy puede adoptarse con
// `db:baseline` antes de desplegar migraciones. No crea, altera ni borra nada.
//
// Uso:
//   DATABASE_URL="postgresql://..." node scripts/check-prod-db.mjs
//
// Pega la salida al revisar un deploy. No imprime credenciales.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const journal = JSON.parse(
  fs.readFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"),
);

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en el entorno.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: "cici-preflight-readonly",
  statement_timeout: 15000,
});

const KEY_TABLES = [
  "users",
  "stores",
  "products",
  "orders",
  "order_items",
  "store_services",
  "appointments",
  "store_reviews",
  "password_resets",
  "device_tokens",
  "protected_payments",
  "store_members",
];

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");

  const info = (
    await client.query(
      "SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS host",
    )
  ).rows[0];
  console.log(`BD: ${info.db} · usuario: ${info.usr} · host: ${info.host ?? "n/d"}`);

  const journalReg = (
    await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t")
  ).rows[0].t;
  console.log(`Journal Drizzle: ${journalReg ? "existe" : "NO existe"}`);

  let lastApplied = null;
  let applied = 0;
  if (journalReg) {
    const row = (
      await client.query(
        'SELECT count(*)::int AS n, max(created_at)::bigint AS last FROM drizzle."__drizzle_migrations"',
      )
    ).rows[0];
    applied = row.n;
    lastApplied = row.last === null ? null : Number(row.last);
    console.log(`Migraciones registradas: ${applied}`);
    if (lastApplied === null) {
      console.log("Última migración registrada: ninguna");
    } else {
      const entry = [...journal.entries].reverse().find((e) => e.when <= lastApplied);
      console.log(
        `Última migración registrada: ${entry ? entry.tag : "desconocida"} (${lastApplied})`,
      );
    }
  }

  const tables = new Set(
    (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
    ).rows.map((r) => r.table_name),
  );
  console.log("\nTablas clave:");
  for (const table of KEY_TABLES) console.log(`  ${tables.has(table) ? "✓" : "✗"} ${table}`);

  if (tables.has("protected_payments")) {
    const cols = new Set(
      (
        await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'protected_payments'`,
        )
      ).rows.map((r) => r.column_name),
    );
    console.log("\nColumnas de auditoría en protected_payments:");
    for (const col of ["paid_out_by", "payout_reference"]) {
      console.log(`  ${cols.has(col) ? "✓" : "✗"} ${col}`);
    }
  }

  const needed = [...KEY_TABLES].filter((t) => !tables.has(t));
  console.log("\nDiagnóstico:");
  if (needed.includes("protected_payments") && needed.includes("store_members")) {
    console.log("  Base legacy (sin pagos protegidos ni equipo).");
    console.log("  Si el resto está sano: baseline --through=0016_device_tokens y luego db:migrate.");
  } else if (needed.length > 0) {
    console.log(`  Faltan tablas: ${needed.join(", ")}. Revisar antes de desplegar.`);
  } else if (lastApplied === null) {
    console.log("  Esquema completo pero sin journal: baseline --through=all.");
  } else {
    const lastEntry = [...journal.entries].reverse().find((e) => e.when <= lastApplied);
    console.log(`  Journal al día hasta ${lastEntry?.tag ?? "desconocido"}.`);
  }

  await client.query("ROLLBACK");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // sin transacción activa
  }
  console.error(`❌ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
