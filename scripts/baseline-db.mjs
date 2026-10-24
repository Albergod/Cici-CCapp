// Adopta una base creada con `db:push` (sin historial de migraciones) en el
// journal de Drizzle, SIN volver a ejecutar el SQL.
//
// Uso:
//   node scripts/baseline-db.mjs --yes
//   node scripts/baseline-db.mjs --yes --force              # sobrescribe el journal
//   node scripts/baseline-db.mjs --yes --through=0019_store_members
//   node scripts/baseline-db.mjs --yes --through=all
//
// Por defecto adopta TODAS las migraciones MENOS LA ÚLTIMA: así la última se
// ejecuta de verdad con `db:migrate`. Si tu base ya tiene también la última,
// usa --through=all. Requisitos: la base ya tiene el esquema (se verifican
// tablas clave). Después, `npm run db:migrate` aplica solo lo que falte.

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(root, "drizzle");
const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

const REQUIRED_TABLES = [
  "users",
  "stores",
  "products",
  "orders",
  "protected_payments",
  "store_members",
];

const args = process.argv.slice(2);
const hasYes = args.includes("--yes");
const force = args.includes("--force");
const throughArg = args.find((a) => a.startsWith("--through="))?.split("=")[1];

if (!hasYes) {
  console.error("Pasé --yes solo si ya verificaste que esta es la base correcta.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en el entorno.");
  process.exit(1);
}
if (!fs.existsSync(journalPath)) {
  console.error(`No se encontró el journal de migraciones: ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const defaultThrough = journal.entries.at(-2)?.tag;
const through = throughArg === "all" ? journal.entries.at(-1)?.tag : (throughArg ?? defaultThrough);
const throughIndex = journal.entries.findIndex((entry) => entry.tag === through);
if (throughIndex < 0) {
  console.error(`--through no coincide con ninguna migración: ${through}`);
  process.exit(1);
}
const migrations = journal.entries.slice(0, throughIndex + 1).map((entry) => {
  const file = path.join(migrationsFolder, `${entry.tag}.sql`);
  if (!fs.existsSync(file)) {
    throw new Error(`Falta el archivo de migración ${file}`);
  }
  const sql = fs.readFileSync(file, "utf8");
  return {
    tag: entry.tag,
    when: entry.when,
    hash: crypto.createHash("sha256").update(sql).digest("hex"),
  };
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  const dbName = (await client.query("SELECT current_database() AS n")).rows[0].n;
  const dbUser = (await client.query("SELECT current_user AS u")).rows[0].u;

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const present = new Set(tables.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `La base no tiene el esquema completo. Faltan tablas: ${missing.join(", ")}. ` +
        "Usa `npm run db:migrate` sobre una base vacía en vez de baseline.",
    );
  }

  await client.query("BEGIN");
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows: existing } = await client.query(
    "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
  );
  if (existing[0].n > 0 && !force) {
    throw new Error(
      `El journal ya tiene ${existing[0].n} migración(es) registrada(s). ` +
        "No se toca. Usa --force solo si sabes que el esquema coincide.",
    );
  }
  if (force) {
    await client.query("DELETE FROM drizzle.__drizzle_migrations");
  }

  for (const migration of migrations) {
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)`,
      [migration.hash, migration.when],
    );
  }

  await client.query("COMMIT");

  console.log(`Base: ${dbName} (usuario ${dbUser})`);
  console.log(`Journal adoptado con ${migrations.length} migraciones:`);
  for (const migration of migrations) console.log(`  ✓ ${migration.tag}`);
  console.log("\nListo. Las próximas migraciones se aplicarán desde la última.");
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
