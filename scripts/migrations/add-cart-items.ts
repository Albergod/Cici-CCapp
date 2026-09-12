// Migración: columna cart_items (jsonb) en conversations.
// Guarda el carrito del cliente dentro del chat para que la IA lo conozca.
// Ejecutar con: npx tsx scripts/migrations/add-cart-items.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Agregando cart_items a conversations...");
    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS cart_items JSONB
    `);
    console.log("✓ Columna cart_items agregada (o ya existía)");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});