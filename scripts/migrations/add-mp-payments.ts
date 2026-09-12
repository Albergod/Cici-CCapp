// Migración: tabla mp_payments para registrar los pagos confirmados de Mercado
// Pago. La activación del plan premium (PRO/BUSINESS) depende exclusivamente de
// esta tabla: solo se activa un plan cuando existe un pago aprobado.
// Ejecutar con: npx tsx scripts/migrations/add-mp-payments.ts

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function up() {
  const client = await pool.connect();
  try {
    console.log("Creando tabla mp_payments...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS mp_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        mp_payment_id text NOT NULL UNIQUE,
        status text NOT NULL,
        plan plan_type NOT NULL,
        cycle subscription_cycle NOT NULL,
        amount numeric(10,2) NOT NULL,
        processed_at timestamp DEFAULT now() NOT NULL,
        store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE
      )
    `);
    console.log("✓ Tabla mp_payments creada");
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch((e) => {
  console.error("Error en migración:", e);
  process.exit(1);
});