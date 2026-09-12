// Migración: columna wa_text en messages.
// Guarda la versión del mensaje destinada al WhatsApp del comerciante cuando
// la respuesta IA contiene una factura (difiere en el aviso de cierre).
// Ejecutar con: npx tsx scripts/migrations/add-wa-text.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Agregando wa_text a messages...");
    await client.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS wa_text text
    `);
    console.log("✓ Columna wa_text agregada (o ya existía)");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});