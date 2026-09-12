// Migración: columnas de "leído" en conversations.
// customer_last_read_at y store_owner_last_read_at permiten calcular los
// mensajes no leídos de cada participante (usados para badges de notificación).
// Ejecutar con: npx tsx scripts/migrations/add-read-state.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Agregando columnas de lectura a conversations...");
    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS customer_last_read_at timestamp,
      ADD COLUMN IF NOT EXISTS store_owner_last_read_at timestamp
    `);

    // Backfill: los mensajes históricos no deben aparecer como no leídos.
    // Solo cuentan como nuevos los mensajes posteriores a la migración.
    await client.query(`
      UPDATE conversations
      SET customer_last_read_at = now(),
          store_owner_last_read_at = now()
      WHERE customer_last_read_at IS NULL
         OR store_owner_last_read_at IS NULL
    `);
    console.log("✓ Columnas agregadas y mensajes históricos marcados como leídos");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});