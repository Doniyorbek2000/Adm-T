import crypto from "crypto";
import { Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { encryptSecret, maskSecret } from "../utils/crypto";
import { PLAN_LIMITS } from "../services/planLimits";
import { ExchangeApiError, getExchangeAdapter } from "../services/exchanges/registry";
import { exchangeMode } from "../services/exchanges/binance";

/**
 * Hisob ulash logikasi:
 *  - Foydalanuvchi broker (Binance/Bybit/OKX) API kalitlarini kiritsa -> haqiqiy hisob
 *    ulanadi va u "AUTO_TRADE" (AI to'liq mustaqil savdo qiladi) yoki
 *    "SIGNAL_ONLY" (faqat signal oladi, savdoni o'zi qiladi) rejimini tanlaydi.
 *  - Agar foydalanuvchi hech qanday hisob ulamasa, tizim avtomatik ravishda
 *    "Demo" hisobini taqdim etadi (virtual balans bilan) - shu orqali u
 *    AI ishlashini xavfsiz tarzda kuzatishi va signallarni ko'rishi mumkin,
 *    keyinchalik istalgan vaqtda real hisobga o'tishi mumkin.
 */

const connectSchema = z.object({
  exchange: z.string().min(2),
  label: z.string().optional(),
  apiKey: z.string().min(4), // MT5 uchun: hisob login raqami
  apiSecret: z.string().min(4), // MT5 uchun: hisob paroli
  passphrase: z.string().min(1).optional(), // faqat OKX/KuCoin uchun: API passphrase (maxfiy ibora)
  server: z.string().min(2).optional(), // faqat MT5 uchun: broker server nomi
  mode: z.enum(["SIGNAL_ONLY", "AUTO_TRADE"]).default("SIGNAL_ONLY"),
  riskLevel: z.number().int().min(1).max(3).default(2),
});

const updateSchema = z.object({
  label: z.string().optional(),
  mode: z.enum(["SIGNAL_ONLY", "AUTO_TRADE"]).optional(),
  riskLevel: z.number().int().min(1).max(3).optional(),
  isConnected: z.boolean().optional(),
});

function serialize(account: any) {
  return {
    id: account.id,
    exchange: account.exchange,
    label: account.label,
    server: account.server ?? null,
    isConnected: account.isConnected,
    mode: account.mode,
    riskLevel: account.riskLevel,
    balanceUsd: account.balanceUsd,
    createdAt: account.createdAt,
  };
}

export const listAccounts = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const accounts = await prisma.brokerAccount.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ accounts: accounts.map((a) => ({ ...serialize(a), apiKeyMasked: maskSecret(a.id) })) });
});

export const connectAccount = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = connectSchema.parse(req.body);

  const limits = PLAN_LIMITS[req.user!.plan];
  const existingCount = await prisma.brokerAccount.count({ where: { userId: req.user!.id } });
  if (existingCount >= limits.maxBrokerAccounts) {
    throw new AppError(
      `Sizning "${req.user!.plan}" tarifingiz bo'yicha maksimal ${limits.maxBrokerAccounts} ta hisob ulash mumkin. Tarifni yangilang.`,
      403
    );
  }

  if (data.mode === "AUTO_TRADE" && !limits.autoTradeAllowed) {
    throw new AppError(
      "To'liq avtomatik savdo (AUTO_TRADE) faqat ULTRA va VIP tariflarida mavjud. Iltimos, tarifingizni yangilang yoki SIGNAL_ONLY rejimini tanlang.",
      403
    );
  }

  // Real integratsiya qilingan birjalar (Binance/Bybit/OKX/KuCoin/BingX) uchun
  // API kalitlarini HAQIQIY birjada tekshiramiz va boshlang'ich balansni
  // birjadan olamiz - bu (1) noto'g'ri/yaroqsiz kalitlarni darhol aniqlaydi
  // (xavfsizlik), (2) foydalanuvchiga soxta emas, balki haqiqiy balansni
  // ko'rsatadi. Hali integratsiya qilinmagan birjalar (MT5, boshqalar) uchun
  // virtual boshlang'ich balans bilan davom etiladi.
  const adapter = getExchangeAdapter(data.exchange);
  let initialBalance = 1000;
  let connectionNotice = "";

  if (adapter) {
    if (adapter.requiresPassphrase && !data.passphrase) {
      throw new AppError(`${adapter.id} hisobini ulash uchun API passphrase (maxfiy ibora) ham kiritilishi shart.`, 400);
    }

    try {
      initialBalance = await adapter.fetchQuoteBalance({ apiKey: data.apiKey, apiSecret: data.apiSecret, passphrase: data.passphrase });
      connectionNotice =
        exchangeMode() === "live"
          ? ` Hisobingiz ${adapter.id}'ning HAQIQIY (live) muhitiga ulandi - AI sizning real mablag'ingiz bilan ishlaydi.`
          : ` Hisobingiz hozircha ${adapter.id} TESTNET/sinov muhitiga ulangan - AI sun'iy test mablag'i bilan ishlaydi, real pulingizga hech qanday ta'sir qilmaydi.`;
    } catch (err) {
      if (err instanceof ExchangeApiError && err.providerCode !== undefined) {
        // Birja o'zi aniq xato kodi bilan rad etdi - bu haqiqatan ham kalit/ruxsat muammosi
        throw new AppError(
          `${adapter.id} API kalit ma'lumotlarini tasdiqlab bo'lmadi: ${err.message}. Iltimos kalit, maxfiy so'z${adapter.requiresPassphrase ? ", passphrase" : ""} va savdo ruxsatlari (Spot Trading) to'g'ri sozlanganini tekshiring.`,
          400
        );
      }
      // Aniq xato kodisiz javob - tarmoq, hosting provayder yoki mintaqaviy
      // bloklash bo'lishi mumkin, shuning uchun foydalanuvchini chalkashtirmaslik
      // uchun umumiyroq xabar beramiz
      throw new AppError(
        `${adapter.id} bilan bog'lanib bo'lmadi. Bu serveringiz joylashgan mintaqa/IP ${adapter.id} tomonidan cheklangani yoki birja vaqtinchalik javob bermayotgani sababli bo'lishi mumkin. Internet aloqangizni va kalitlaringizni tekshirib, birozdan so'ng qayta urinib ko'ring.`,
        502
      );
    }
  }

  // ID'ni oldindan generatsiya qilamiz - shifrlangan qiymatlarni shu yozuvga
  // "bog'lash" (AAD context) uchun u shifrlashdan oldin ma'lum bo'lishi kerak
  const accountId = crypto.randomUUID();
  const account = await prisma.brokerAccount.create({
    data: {
      id: accountId,
      userId: req.user!.id,
      exchange: data.exchange,
      label: data.label ?? data.exchange,
      apiKeyEncrypted: encryptSecret(data.apiKey, `${accountId}:apiKey`),
      apiSecretEncrypted: encryptSecret(data.apiSecret, `${accountId}:apiSecret`),
      passphraseEncrypted: data.passphrase ? encryptSecret(data.passphrase, `${accountId}:passphrase`) : undefined,
      server: data.exchange === "MT5" ? data.server : undefined,
      mode: data.mode,
      riskLevel: data.riskLevel,
      balanceUsd: initialBalance,
    },
  });

  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      title: "Hisob muvaffaqiyatli ulandi",
      message: `${account.exchange} (${account.label}) hisobingiz ulandi. Rejim: ${
        account.mode === "AUTO_TRADE" ? "AI to'liq avtomatik savdo qiladi" : "Faqat AI signallarini olasiz"
      }.${connectionNotice}`,
    },
  });

  res.status(201).json({ account: { ...serialize(account), apiKeyMasked: maskSecret(account.id) } });
});

/**
 * Hisob ulamagan foydalanuvchilar uchun: tizim ularga "Demo" virtual hisob ochib beradi.
 * Bu orqali ular pul tavakkal qilmasdan AI qanday savdo qilishini ko'rishlari mumkin.
 */
export const createDemoAccount = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const existingDemo = await prisma.brokerAccount.findFirst({
    where: { userId: req.user!.id, exchange: "Demo" },
  });
  if (existingDemo) {
    return res.json({ account: { ...serialize(existingDemo), apiKeyMasked: "DEMO-MODE" } });
  }

  const demoAccountId = crypto.randomUUID();
  const account = await prisma.brokerAccount.create({
    data: {
      id: demoAccountId,
      userId: req.user!.id,
      exchange: "Demo",
      label: "Bepul Demo hisob (virtual)",
      apiKeyEncrypted: encryptSecret("demo", `${demoAccountId}:apiKey`),
      apiSecretEncrypted: encryptSecret("demo", `${demoAccountId}:apiSecret`),
      mode: "SIGNAL_ONLY",
      riskLevel: 2,
      balanceUsd: 10_000,
    },
  });

  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      title: "Demo hisob ochildi",
      message:
        "Sizga $10,000 virtual balansga ega Demo hisob taqdim etildi. Real hisob ulamasangiz ham AI strategiyasini shu yerda kuzatishingiz mumkin.",
    },
  });

  res.status(201).json({ account: { ...serialize(account), apiKeyMasked: "DEMO-MODE" } });
});

export const updateAccount = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = updateSchema.parse(req.body);
  const account = await prisma.brokerAccount.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!account) throw new AppError("Hisob topilmadi", 404);

  if (data.mode === "AUTO_TRADE") {
    const limits = PLAN_LIMITS[req.user!.plan];
    if (!limits.autoTradeAllowed) {
      throw new AppError("To'liq avtomatik savdo faqat ULTRA va VIP tariflarida mavjud.", 403);
    }
  }

  const updated = await prisma.brokerAccount.update({
    where: { id: account.id },
    data,
  });

  res.json({ account: { ...serialize(updated), apiKeyMasked: maskSecret(updated.id) } });
});

export const deleteAccount = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const account = await prisma.brokerAccount.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!account) throw new AppError("Hisob topilmadi", 404);

  await prisma.brokerAccount.delete({ where: { id: account.id } });
  res.json({ message: "Hisob uzildi" });
});

export const syncBalance = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const account = await prisma.brokerAccount.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!account) throw new AppError("Hisob topilmadi", 404);

  if (account.exchange === "Demo") {
    return res.json({ balanceUsd: account.balanceUsd, synced: false, message: "Demo hisob balansi birjadan yangilanmaydi" });
  }

  const adapter = getExchangeAdapter(account.exchange);
  if (!adapter) {
    return res.json({ balanceUsd: account.balanceUsd, synced: false, message: "Bu birja uchun avtomatik sinxronizatsiya mavjud emas" });
  }

  const { decryptSecret } = await import("../utils/crypto");
  const credentials = {
    apiKey: decryptSecret(account.apiKeyEncrypted, `${account.id}:apiKey`),
    apiSecret: decryptSecret(account.apiSecretEncrypted, `${account.id}:apiSecret`),
    passphrase: account.passphraseEncrypted
      ? decryptSecret(account.passphraseEncrypted, `${account.id}:passphrase`)
      : undefined,
  };

  const balanceUsd = await adapter.fetchQuoteBalance(credentials);
  await prisma.brokerAccount.update({ where: { id: account.id }, data: { balanceUsd } });

  res.json({ balanceUsd, synced: true });
});
