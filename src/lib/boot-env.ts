import path from "path";
import fs from "fs";
import dotenv from "dotenv";

const candidates = [
  path.join(__dirname, "..", "..", ".env"),
  path.join(process.cwd(), ".env"),
];

for (const envFile of candidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
    break;
  }
}