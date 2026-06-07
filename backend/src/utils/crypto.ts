import crypto from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
// ENCRYPTION_KEY env'dan olingan satrni 32 baytlik kalitga aylantiramiz
const KEY = crypto.createHash("sha256").update(env.encryptionKey).digest();

/**
 * Foydalanuvchi broker API kalit/maxfiy so'zlarini bazada ochiq saqlamaslik uchun shifrlaymiz.
 * Format: iv:authTag:cipherText (hex, ":" bilan ajratilgan)
 */
export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivHex, authTagHex, cipherHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipherText = Buffer.from(cipherHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Foydalanuvchiga ko'rsatish uchun kalitni maskalash, masalan: "ab12******ef90" */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}
