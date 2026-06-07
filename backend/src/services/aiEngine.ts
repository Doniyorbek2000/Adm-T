import { PlanType, SignalDirection, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";

/**
 * ADM Trading AI Engine
 * --------------------------------------------------------------
 * Bu modul "sun'iy intellekt" tahlil va savdo mexanizmini simulyatsiya qiladi:
 *   1) Bozorni "tahlil qilib" yangi savdo signallarini generatsiya qiladi
 *   2) Ochiq signallarni vaqt o'tishi bilan TP/SL bo'yicha yopadi
 *   3) AUTO_TRADE rejimidagi foydalanuvchi hisoblari uchun signalllar asosida
 *      avtomatik savdo (trade) ochadi va yopadi - foydalanuvchi ishtirokisiz
 *
 * Real loyihada bu yerga birja narx oqimlari (WebSocket), texnik indikatorlar
 * (RSI, MACD, Bollinger va h.k.) va ML modeli ulanadi. Hozircha mantiqiy
 * skelet sifatida real vaqt rejimida ishlovchi deterministik-tasodifiy
 * generator ishlatiladi - bu butun zanjirni (signal -> avto-treding -> natija)
 * odam ishtirokisiz to'liq namoyish etadi.
 */

const SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "BNB/USDT",
  "SOL/USDT",
  "XRP/USDT",
  "TON/USDT",
  "ADA/USDT",
  "AVAX/USDT",
];

const ANALYSIS_TEMPLATES = [
  "RSI ortiqcha sotilgan zonadan chiqmoqda, kuchli qaytish (reversal) ehtimoli yuqori.",
  "50 va 200 davriy harakatlanuvchi o'rtachalar 'oltin kesishma' hosil qildi - ko'tarilish trendi kutilmoqda.",
  "Narx muhim qo'llab-quvvatlash darajasidan sakradi, hajm (volume) sezilarli o'sdi.",
  "MACD signalligi kesib o'tdi - momentum o'zgarishi aniqlandi.",
  "Bollinger lentalari torayib bormoqda - volatillik portlashi (breakout) yaqinlashmoqda.",
  "Yuqori vaqt oralig'idagi trend bilan moslik tasdiqlandi, risk/foyda nisbati qulay.",
  "Likvidlik zonasiga yaqinlashish va order-block tahlili asosida kirish nuqtasi aniqlandi.",
  "Fibonacci tuzatish darajasi 0.618 dan qaytish signali shakllandi.",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function basePriceFor(symbol: string): number {
  switch (symbol) {
    case "BTC/USDT":
      return 65000;
    case "ETH/USDT":
      return 3400;
    case "BNB/USDT":
      return 580;
    case "SOL/USDT":
      return 165;
    case "XRP/USDT":
      return 0.62;
    case "TON/USDT":
      return 7.4;
    case "ADA/USDT":
      return 0.45;
    case "AVAX/USDT":
      return 36;
    default:
      return 100;
  }
}

/** Ishonch darajasiga qarab signalni qaysi tarif birinchi bo'lib ko'rishini aniqlaydi */
function minPlanForConfidence(confidence: number): PlanType {
  if (confidence >= 90) return PlanType.VIP;
  if (confidence >= 80) return PlanType.ULTRA;
  if (confidence >= 70) return PlanType.PRO;
  return PlanType.FREE;
}

export async function generateSignal() {
  const symbol = pick(SYMBOLS);
  const direction = pick([SignalDirection.BUY, SignalDirection.SELL]);
  const base = basePriceFor(symbol);
  const entryPrice = Number((base * randomBetween(0.985, 1.015)).toFixed(symbol === "XRP/USDT" || symbol === "ADA/USDT" ? 4 : 2));

  const tpDistancePct = randomBetween(0.015, 0.06); // 1.5% - 6%
  const slDistancePct = randomBetween(0.008, 0.025); // 0.8% - 2.5%

  const takeProfit =
    direction === SignalDirection.BUY
      ? Number((entryPrice * (1 + tpDistancePct)).toFixed(6))
      : Number((entryPrice * (1 - tpDistancePct)).toFixed(6));
  const stopLoss =
    direction === SignalDirection.BUY
      ? Number((entryPrice * (1 - slDistancePct)).toFixed(6))
      : Number((entryPrice * (1 + slDistancePct)).toFixed(6));

  const confidence = Math.round(randomBetween(60, 97));
  const minPlan = minPlanForConfidence(confidence);

  const signal = await prisma.signal.create({
    data: {
      symbol,
      direction,
      entryPrice,
      takeProfit,
      stopLoss,
      confidence,
      analysis: pick(ANALYSIS_TEMPLATES),
      minPlan,
      status: SignalStatus.ACTIVE,
    },
  });

  return signal;
}

/**
 * Faol signallarni "bozor harakati" asosida yopadi: ma'lum vaqt o'tgach
 * tasodifiy ravishda TP yoki SL bajarilgan deb belgilaydi (ishonch darajasi
 * yuqori bo'lgan signallar TP'ga tegish ehtimoli yuqoriroq bo'ladi).
 */
export async function evaluateOpenSignals() {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000); // kamida 3 daqiqa "ochiq" tursin

  const activeSignals = await prisma.signal.findMany({
    where: { status: SignalStatus.ACTIVE, createdAt: { lte: cutoff } },
  });

  for (const signal of activeSignals) {
    // Faqat bir qism faol signallarni har siklda yopamiz - real bozor kabi
    if (Math.random() > 0.4) continue;

    const winProbability = 0.5 + signal.confidence / 250; // confidence qancha baland - g'alaba ehtimoli shuncha yuqori
    const isWin = Math.random() < winProbability;

    const status = isWin ? SignalStatus.TP_HIT : SignalStatus.SL_HIT;
    const resultPnlPct = isWin
      ? Math.abs((signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100
      : -Math.abs((signal.stopLoss - signal.entryPrice) / signal.entryPrice) * 100;

    await prisma.signal.update({
      where: { id: signal.id },
      data: { status, resultPnlPct, closedAt: new Date() },
    });

    await closeTradesForSignal(signal.id, isWin ? signal.takeProfit : signal.stopLoss, resultPnlPct);
  }
}

async function closeTradesForSignal(signalId: string, exitPrice: number, resultPnlPct: number) {
  const openTrades = await prisma.trade.findMany({
    where: { signalId, status: "OPEN" },
  });

  for (const trade of openTrades) {
    const pnlUsd = Number(((trade.entryPrice * trade.quantity * resultPnlPct) / 100).toFixed(2));
    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: "CLOSED", exitPrice, pnlUsd, closedAt: new Date() },
    });

    if (trade.brokerAccountId) {
      await prisma.brokerAccount.update({
        where: { id: trade.brokerAccountId },
        data: { balanceUsd: { increment: pnlUsd } },
      });
    }

    await prisma.notification.create({
      data: {
        userId: trade.userId,
        title: pnlUsd >= 0 ? "AI savdosi foyda bilan yopildi" : "AI savdosi zarar bilan yopildi",
        message: `${trade.symbol} ${trade.direction} savdosi yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$`,
      },
    });
  }
}

/**
 * AUTO_TRADE rejimidagi va tarifi avto-tredingga ruxsat beruvchi barcha
 * foydalanuvchi hisoblari uchun yangi signal asosida avtomatik savdo ochadi.
 * Foydalanuvchi hech qanday amal bajarmaydi - butunlay AI tomonidan boshqariladi.
 */
export async function autoExecuteSignal(signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number; minPlan: PlanType }) {
  const planRank: Record<PlanType, number> = { FREE: 0, PRO: 1, ULTRA: 2, VIP: 3 };

  const accounts = await prisma.brokerAccount.findMany({
    where: { mode: "AUTO_TRADE", isConnected: true },
    include: { user: true },
  });

  for (const account of accounts) {
    if (!account.user.isActive) continue;
    if (planRank[account.user.plan as PlanType] < planRank[signal.minPlan]) continue; // tarifi yetarli emas

    // Risk darajasi past foydalanuvchilar faqat yuqori ishonchli signallarda ishtirok etadi
    const minConfidenceByRisk: Record<number, number> = { 1: 80, 2: 70, 3: 60 };
    if (signal.confidence < (minConfidenceByRisk[account.riskLevel] ?? 70)) continue;

    // Risk darajasiga qarab balansning bir qismini savdoga qo'yadi
    const riskFractionByLevel: Record<number, number> = { 1: 0.03, 2: 0.07, 3: 0.15 };
    const riskFraction = riskFractionByLevel[account.riskLevel] ?? 0.05;
    const positionUsd = Math.max(account.balanceUsd * riskFraction, 10);
    const quantity = Number((positionUsd / signal.entryPrice).toFixed(6));

    if (quantity <= 0) continue;

    await prisma.trade.create({
      data: {
        userId: account.userId,
        brokerAccountId: account.id,
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        quantity,
        executedByAi: true,
        status: "OPEN",
      },
    });

    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "AI yangi savdoni avtomatik ochdi",
        message: `${signal.symbol} bo'yicha ${signal.direction === "BUY" ? "xarid" : "sotish"} pozitsiyasi ochildi (ishonch: ${signal.confidence}%).`,
      },
    });
  }
}

/** Bitta to'liq AI sikli: bozorni tahlil qilish, signal yaratish, ochiq pozitsiyalarni baholash */
export async function runAiCycle() {
  await evaluateOpenSignals();

  // Har bir siklda ~60% ehtimol bilan yangi signal generatsiya qilinadi
  if (Math.random() < 0.6) {
    const signal = await generateSignal();
    await autoExecuteSignal({
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction as SignalDirection,
      entryPrice: signal.entryPrice,
      confidence: signal.confidence,
      minPlan: signal.minPlan as PlanType,
    });
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Serverga ulanganda AI siklini fonda muntazam ishga tushiradi (odam ishtirokisiz) */
export function startAiEngine(intervalMs = 60_000) {
  if (intervalHandle) return;
  runAiCycle().catch((err) => console.error("AI cycle error:", err));
  intervalHandle = setInterval(() => {
    runAiCycle().catch((err) => console.error("AI cycle error:", err));
  }, intervalMs);
  console.log(`AI Engine ishga tushdi (har ${intervalMs / 1000}s da bozorni tahlil qiladi)`);
}

export function stopAiEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
