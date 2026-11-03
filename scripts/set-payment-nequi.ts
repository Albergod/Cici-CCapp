import "dotenv/config";
import { db } from "../src/db/client";
import { stores } from "../src/db/schema";
import { eq } from "drizzle-orm";

const storeId = process.argv[2];
const phone = process.argv[3] ?? "3001234567";
if (!storeId) {
  console.error("storeId requerido");
  process.exit(1);
}

async function main() {
  await db
    .update(stores)
    .set({ paymentNequi: phone, protectedEnabled: false })
    .where(eq(stores.id, storeId));
  console.log(`paymentNequi=${phone} para ${storeId}`);
  process.exit(0);
}

void main();
