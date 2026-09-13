// Migración: pagos sin tienda. Permite que un comerciante pague su plan ANTES
// de crear la tienda: mp_payments.store_id pasa a ser opcional y se añade
// user_id para saber a quién se le actúa el plan cuando cree su tienda.
// Ejecutar con: npx tsx scripts/migrations/payments-without-store.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Haciendo store_id opcional en mp_payments...");
    await client.query(`
      ALTER TABLE mp_payments
        ALTER COLUMN store_id DROP NOT NULL
    `);
    console.log("Añadiendo user_id a mp_payments...");
    await client.query(`
      ALTER TABLE mp_payments
        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL
    `);
    console.log("✓ migración payments-without-store aplicada");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});