// Migración simple: el tipo de cartItems cambió de {productId, quantity} a
// {productId, quantity, options?}. Como la columna sigue siendo JSONB, no
// requiere cambio de esquema, pero este archivo sirve como referencia de versión.
// La columna se modificó directamente en schema.ts; drizzle-kit sync actualizará el tipado.

import { sql } from "drizzle-orm";
import { db } from "../../src/db/client";

async function up() {
  // No es necesario cambiar columna JSONB; el tipo en TypeScript ya lo refleja.
  console.log("CartItems ya incluye campo 'options' opcional");
}

async function down() {
  console.log("Rollback no aplicable");
}

export { up, down };

if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}