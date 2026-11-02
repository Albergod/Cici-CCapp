// Cifrado simétrico para datos bancarios en reposo (AES-256-GCM).
//
// La clave se toma de PAYOUT_ENCRYPTION_KEY. Si no existe, se deriva de
// JWT_SECRET para no bloquear desarrollo/test; en producción enforceEnv exige
// una clave propia para no reutilizar el secreto de sesiones.
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionSecret(): string {
  return process.env.PAYOUT_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
}

/** true si hay material para cifrar (la API debe responder 503 si no). */
export function canEncrypt(): boolean {
  return encryptionSecret().trim().length > 0;
}

function key(): Buffer {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Falta PAYOUT_ENCRYPTION_KEY/JWT_SECRET para cifrar datos bancarios");
  // Derivación estable: la misma clave en cada arranque con el mismo secreto.
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/** Cifra un texto y devuelve base64(iv | authTag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Descifra un valor producido por encryptSecret. Lanza si fue alterado. */
export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length <= IV_BYTES + 16) throw new Error("Dato cifrado inválido");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = raw.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Últimos 4 dígitos para mostrar sin revelar la cuenta completa. */
export function last4(value: string): string {
  return value.replace(/\s+/g, "").slice(-4);
}

/**
 * Hash determinista de un código de acceso de invitado. No usa el cifrado
 * reversible: el código no debe poder recuperarse desde la base.
 */
export function hashGuestCode(code: string): string {
  const secret = process.env.GUEST_CODE_PEPPER || process.env.JWT_SECRET || "cici-guest";
  return crypto.createHmac("sha256", secret).update(code.trim().toUpperCase(), "utf8").digest("hex");
}

/** Comparación en tiempo constante para códigos de invitado. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Código de invitado legible y de alta entropía (32 hex chars). */
export function generateGuestCode(): string {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}
