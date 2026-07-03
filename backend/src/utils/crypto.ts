import crypto from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "v2";

// "Xom" ENCRYPTION_KEY satrini to'g'ridan-to'g'ri AES kaliti sifatida ishlatish
// xavfli - agar u qisqa/oddiy bo'lsa (masalan, parol uslubida), shifrlash kaliti
// ham zaif bo'lib qoladi. scrypt - "memory-hard" kalit hosil qilish funksiyasi
// (parol xeshlashda ishlatiladigan), uni GPU/ASIC orqali ommaviy tarzda urinib
// ko'rish (brute-force) ancha qimmat va sekin bo'lishini ta'minlaydi.
const KEY_DERIVATION_SALT = "adm-trading:broker-secret:v2";
const KEY = crypto.scryptSync(env.encryptionKey, KEY_DERIVATION_SALT, 32);

// v1 format (eski, AAD'siz, sodda SHA-256 xosh orqali olingan kalit) - faqat
// ilgari shifrlangan yozuvlarni o'qish (orqaga moslik) uchun saqlanadi. Yangi
// shifrlash hech qachon bu kalit bilan amalga oshirilmaydi.
const LEGACY_KEY = crypto.createHash("sha256").update(env.encryptionKey).digest();

/**
 * Foydalanuvchi broker API kalit/maxfiy so'zlarini bazada ochiq saqlamaslik
 * uchun AES-256-GCM bilan shifrlaymiz va konkret yozuv/maydonga "bog'laymiz".
 *
 * `context` - masalan "<brokerAccountId>:apiKey" - shifrmatnga "Additional
 * Authenticated Data" (AAD) sifatida kiritiladi. Bu shuni anglatadiki: agar
 * tajovuzkor (masalan, SQL-injection yoki bazaga to'g'ridan-to'g'ri kirish
 * orqali) shifrlangan qiymatlarni boshqa foydalanuvchi/maydon yozuviga
 * ko'chirib qo'ysa, deshifrlashda autentifikatsiya xatosi yuz beradi va
 * noto'g'ri (ammo "muvaffaqiyatli ko'rinadigan") qiymat hech qachon
 * qaytarilmaydi - bu "ciphertext almashtirish" hujumlaridan himoya qiladi.
 *
 * Format: v2:iv:authTag:cipherText (hex, ":" bilan ajratilgan)
 */
export function encryptSecret(plainText: string, context: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(payload: string, context: string): string {
  const parts = payload.split(":");

  // Eski format: "iv:authTag:cipherText" (versiya prefiksi va AAD'siz)
  if (parts.length === 3) {
    const [ivHex, authTagHex, cipherHex] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, LEGACY_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
  }

  const [version, ivHex, authTagHex, cipherHex] = parts;
  if (version !== FORMAT_VERSION) {
    throw new Error(`Noma'lum shifrlash format versiyasi: ${version}`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Foydalanuvchiga ko'rsatish uchun kalitni maskalash, masalan: "ab12******ef90" */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}
