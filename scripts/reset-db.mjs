// Vacía TODA la base (mantiene el esquema) para arrancar en producción en cero.
//
// Es 100% manual: nunca corre solo ni en el deploy. Para ejecutarlo:
//   DATABASE_URL=... node scripts/reset-db.mjs --yes
//   (opcional --db-check=nombre para negarse si la BD no coincide)
//
// Trunca las 12 tablas con CASCADE (resetea secuencias). No toca
// __drizzle_migrations (historial de migraciones).

import pg from "pg";

const { Pool } = pg;

const TABLES = [
  "users",
  "stores",
  "categories",
  "products",
  "follows",
  "conversations",
  "messages",
  "sales",
  "violations",
  "sale_items",
  "mp_payments",
  "payment_reports",
];

const args = process.argv.slice(2);
const hasYes = args.includes("--yes");
const dbCheck = args.find((a) => a.startsWith("--db-check="))?.split("=")[1];

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en el entorno.");
  process.exit(1);
}
if (!hasYes) {
  console.error("Pasé el flag --yes solo si estás seguro de vaciar esta BD.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const dbName = (await pool.query("SELECT current_database() AS n")).rows[0].n;
  const dbUser = (await pool.query("SELECT current_user AS u")).rows[0].u;

  if (dbCheck && dbName !== dbCheck) {
    console.error(`Abortado: la BD es "${dbName}" pero pediste --db-check=${dbCheck}`);
    process.exit(1);
  }

  const before = {};
  for (const t of TABLES) {
    const [{ n }] = (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows;
    before[t] = n;
  }

  console.log(`Base: ${dbName} (usuario ${dbUser})`);
  console.log("Filas antes del reset:");
  for (const [t, n] of Object.entries(before)) console.log(`  ${t.padEnd(18)} ${n}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`,
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  console.log("\nBase vaciada. Esquema intacto. Lista para producción.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});