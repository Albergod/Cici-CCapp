// Migración: columna business_type (enum) en stores.
// Define el tipo de negocio de la tienda (ROPA, CALZADO, ACCESORIOS...)
// para saber si sus productos requieren talla o no.
// Ejecutar con: npx tsx scripts/migrations/add-business-type.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Creando enum business_type...");
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_type') THEN
          CREATE TYPE business_type AS ENUM ('ROPA','CALZADO','ACCESORIOS','HOGAR','ALIMENTOS','SERVICIOS','OTRO');
        END IF;
      END $$;
    `);

    console.log("Agregando business_type a stores...");
    await client.query(`
      ALTER TABLE stores
      ADD COLUMN IF NOT EXISTS business_type business_type NOT NULL DEFAULT 'OTRO'
    `);
    console.log("✓ Columna business_type agregada (o ya existía)");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});