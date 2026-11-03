import "dotenv/config";
import { db } from "../src/db/client";
import { stores } from "../src/db/schema";
import { eq } from "drizzle-orm";

const storeId = process.argv[2];
if (!storeId) {
  console.error("storeId requerido");
  process.exit(1);
}

await db.update(stores).set({ protectedEnabled: true }).where(eq(stores.id, storeId));
console.log(`protectedEnabled=true para ${storeId}`);
process.exit(0);
