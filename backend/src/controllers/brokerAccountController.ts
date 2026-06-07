import { Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { encryptSecret, maskSecret } from "../utils/crypto";
import { PLAN_LIMITS } from "../services/planLimits";
import { BinanceApiError, exchangeMode, fetchUsdtBalance } from "../services/exchanges/binance";

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
    apiKeyMasked: maskSecret(account.apiKeyEncrypted ? account.exchange : ""), // placeholder, real masked value set below
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

  // Binance uchun API kalit/maxfiy so'zni HAQIQIY birjada tekshiramiz va
  // boshlang'ich balansni birjadan olamiz - bu (1) noto'g'ri/yaroqsiz
  // kalitlarni darhol aniqlaydi (xavfsizlik), (2) foydalanuvchiga soxta emas,
  // balki haqiqiy balansni ko'rsatadi.
  let initialBalance = 1000; // boshqa (hali integratsiya qilinmagan) birjalar uchun virtual boshlang'ich balans
  let connectionNotice = "";
  if (data.exchange === "Binance") {
    try {
      initialBalance = await fetchUsdtBalance(data.apiKey, data.apiSecret);
      connectionNotice =
        exchangeMode() === "live"
          ? " Hisobingiz Binance'ning HAQIQIY (live) muhitiga ulandi - AI sizning real mablag'ingiz bilan ishlaydi."
          : " Hisobingiz hozircha Binance TESTNET (sinov) muhitiga ulangan - AI sun'iy test mablag'i bilan ishlaydi, real pulingizga hech qanday ta'sir qilmaydi.";
    } catch (err) {
      if (err instanceof BinanceApiError && err.code !== undefined) {
        // Binance o'zi aniq xato kodi bilan rad etdi (masalan, -2014/-2015 -
        // noto'g'ri kalit yoki ruxsat) - bu haqiqatan ham kalit muammosi
        throw new AppError(
          "Binance API kalit/maxfiy so'zini tasdiqlab bo'lmadi. Iltimos: (1) kalit va maxfiy so'z to'g'ri kiritilganini, (2) 'Enable Spot & Margin Trading' ruxsati yoqilganini, (3) IP cheklovlari to'g'ri sozlanganini tekshiring.",
          400
        );
      }
      // Binance'dan aniq xato kodisiz javob (masalan, tarmoq, hosting provayder
      // yoki mintaqaviy bloklash) - bu kalitning o'zi emas, ulanish muammosi
      // bo'lishi mumkin, shuning uchun foydalanuvchini chalkashtirmaslik uchun
      // umumiyroq xabar beramiz
      throw new AppError(
        "Binance bilan bog'lanib bo'lmadi. Bu serveringiz joylashgan mintaqa/IP Binance tomonidan cheklangani yoki birja vaqtinchalik javob bermayotgani sababli bo'lishi mumkin. Internet aloqangizni va kalitlaringizni tekshirib, birozdan so'ng qayta urinib ko'ring.",
        502
      );
    }
  }

  const account = await prisma.brokerAccount.create({
    data: {
      userId: req.user!.id,
      exchange: data.exchange,
      label: data.label ?? data.exchange,
      apiKeyEncrypted: encryptSecret(data.apiKey),
      apiSecretEncrypted: encryptSecret(data.apiSecret),
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

  const account = await prisma.brokerAccount.create({
    data: {
      userId: req.user!.id,
      exchange: "Demo",
      label: "Bepul Demo hisob (virtual)",
      apiKeyEncrypted: encryptSecret("demo"),
      apiSecretEncrypted: encryptSecret("demo"),
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
