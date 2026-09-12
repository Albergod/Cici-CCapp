// Migración: columna asserted_product_id en conversations y ai_generated en messages
// Ejecutar con: npx tsx scripts/migrations/add-ai-fields.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Agregando asserted_product_id a conversations...");
    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS asserted_product_id UUID
        REFERENCES products(id) ON DELETE SET NULL
    `);
    console.log("Columna asserted_product_id agregada (o ya existía)");

    console.log("Agregando ai_generated a messages...");
    await client.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT false
    `);
    console.log("Columna ai_generated agregada (o ya existía)");

    console.log("✓ Migración completada");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});