import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

const DEV_DEFAULTS = {
  JWT_SECRET: "dev-secret-change-me",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  ADMIN_PASSWORD: "Admin123!",
};

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),
  jwtSecret: required("JWT_SECRET", DEV_DEFAULTS.JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  encryptionKey: required("ENCRYPTION_KEY", DEV_DEFAULTS.ENCRYPTION_KEY),
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@admtrading.uz",
  adminPassword: process.env.ADMIN_PASSWORD ?? DEV_DEFAULTS.ADMIN_PASSWORD,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  // "testnet" (standart, xavfsiz sinov muhiti - sun'iy mablag') yoki "live"
  // (haqiqiy birja, REAL pul bilan ishlaydi). Productionga o'tishdan oldin
  // operatsion jamoa tomonidan ongli ravishda "live" ga o'rnatilishi shart.
  exchangeMode: (process.env.EXCHANGE_MODE === "live" ? "live" : "testnet") as "testnet" | "live",

  // To'lov tizimi: "test" (simulyatsiya, darhol faollashadi),
  // "click" (Click.uz), yoki "payme" (Payme.uz)
  paymentMode: (process.env.PAYMENT_MODE ?? "test") as "test" | "click" | "payme",
  clickMerchantId: process.env.CLICK_MERCHANT_ID ?? "",
  clickServiceId: process.env.CLICK_SERVICE_ID ?? "",
  clickSecretKey: process.env.CLICK_SECRET_KEY ?? "",
  paymeMerchantId: process.env.PAYME_MERCHANT_ID ?? "",
  paymeKey: process.env.PAYME_KEY ?? "",

  // MetaApi (MT5 ko'prigi) — metaapi.cloud hisobidagi API kaliti
  metaApiToken: process.env.METAAPI_TOKEN ?? "",

  // Futures leverage (konservativ standart: 3x). Katta leverage = katta
  // likvidatsiya xavfi; pozitsiya o'lchamini baribir risk-menejer boshqaradi.
  futuresLeverage: Math.max(1, Math.min(20, Number(process.env.FUTURES_LEVERAGE) || 3)),

  // Telegram xabarnomalar (ixtiyoriy): bot token va chat ID
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};

/**
 * Standart (placeholder) maxfiy qiymatlar faqat lokal ishlab chiqish uchun
 * mo'ljallangan - ular ommaga ma'lum bo'lgani sababli production'da
 * ishlatilsa, shifrlangan API kalitlar va JWT tokenlar osongina buzilishi
 * mumkin. EXCHANGE_MODE="live" (ya'ni real pul bilan ishlash) tanlangan
 * bo'lsa, bunday zaif qiymatlar bilan serverni ishga tushirishni butunlay
 * rad etamiz - bu xato emas, ataylab qo'yilgan xavfsizlik to'sig'i.
 */
function checkSecretStrength() {
  const weak: string[] = [];
  if (env.jwtSecret === DEV_DEFAULTS.JWT_SECRET || env.jwtSecret.length < 32) weak.push("JWT_SECRET");
  if (env.encryptionKey === DEV_DEFAULTS.ENCRYPTION_KEY || env.encryptionKey.length < 32) weak.push("ENCRYPTION_KEY");
  if (env.adminPassword === DEV_DEFAULTS.ADMIN_PASSWORD) weak.push("ADMIN_PASSWORD");

  if (weak.length === 0) return;

  const message = `OGOHLANTIRISH: quyidagi maxfiy qiymatlar standart/zaif holatda: ${weak.join(", ")}. Production muhitida ularni kuchli, tasodifiy qiymatlarga (masalan: "openssl rand -hex 32") almashtiring - aks holda foydalanuvchi ma'lumotlari va shifrlangan birja API kalitlari xavf ostida qoladi.`;

  if (env.exchangeMode === "live") {
    throw new Error(
      `${message}\n\nEXCHANGE_MODE="live" (HAQIQIY pul bilan savdo) yoqilgan, shuning uchun server zaif maxfiy qiymatlar bilan ISHGA TUSHIRILMAYDI. Avval .env faylidagi qiymatlarni almashtiring.`
    );
  }

  console.warn(`\n⚠️  ${message}\n`);
}

checkSecretStrength();
