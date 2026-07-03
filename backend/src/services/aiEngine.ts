import { PlanType, SignalDirection, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { decryptSecret } from "../utils/crypto";
import { exchangeMode, fetchSpotPrice } from "./exchanges/binance";
import { ExchangeAdapter, ExchangeCredentials, getExchangeAdapter, isRealExchangeIntegrated } from "./exchanges/registry";
import { PLAN_LIMITS } from "./planLimits";
import { findBestSignal } from "./technicalAnalysis";

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

function minPlanForConfidence(confidence: number): PlanType {
  if (confidence >= 90) return PlanType.VIP;
  if (confidence >= 80) return PlanType.ULTRA;
  if (confidence >= 70) return PlanType.PRO;
  return PlanType.FREE;
}

/**
 * Haqiqiy texnik tahlil asosida signal yaratadi.
 * RSI, MACD, EMA, BB, Stochastic, ATR indikatorlaridan foydalanadi.
 * Tasodifiy emas — real bozor ma'lumotlariga asoslangan.
 */
export async function generateSignal() {
  const result = await findBestSignal(SYMBOLS);

  // Agar hech qanday kuchli signal topilmasa — null qaytarish (bu siklda signal yaratilmaydi)
  if (!result) {
    console.log("[AI Engine] Bu siklda kuchli signal topilmadi (bozor neytral)");
    return null;
  }

  const { symbol, signal: ta } = result;
  const confidence = ta.confidence;
  const minPlan = minPlanForConfidence(confidence);

  const direction = ta.direction === "BUY" ? SignalDirection.BUY : SignalDirection.SELL;

  console.log(
    `[AI Engine] ${symbol} ${ta.direction} signali | Ishonch: ${confidence}% | ` +
    `RSI: ${ta.indicators.rsi} | MACD: ${ta.indicators.macdHist > 0 ? "+" : ""}${ta.indicators.macdHist.toFixed(4)} | ` +
    `BB%: ${ta.indicators.bbPercent}% | ATR: ${ta.indicators.atr.toFixed(4)}`
  );

  const signal = await prisma.signal.create({
    data: {
      symbol,
      direction,
      entryPrice: ta.entryPrice,
      takeProfit: ta.takeProfit,
      stopLoss:   ta.stopLoss,
      confidence,
      analysis:   ta.analysis,
      minPlan,
      status: SignalStatus.ACTIVE,
    },
  });

  return signal;
}

/**
 * Faol signallarni HAQIQIY Binance narxi bilan solishtirib yopadi.
 * TP/SL darajasiga narx yetganda — yopiladi. Tasodifiy emas, real bozorga asoslangan.
 * 48 soatdan oshgan signallar joriy narxda majburiy yopiladi.
 */
export async function evaluateOpenSignals() {
  const minAgeCutoff  = new Date(Date.now() - 3 * 60 * 1000);
  const expiryCutoff  = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const activeSignals = await prisma.signal.findMany({
    where: { status: SignalStatus.ACTIVE, createdAt: { lte: minAgeCutoff } },
  });

  for (const signal of activeSignals) {
    const isBuy = signal.direction === SignalDirection.BUY;

    let currentPrice: number;
    try {
      currentPrice = await fetchSpotPrice(signal.symbol);
    } catch {
      continue; // Narxni olish imkonsiz bo'lsa, keyingi siklga qoldirish
    }

    let status: SignalStatus | null = null;
    let exitPrice: number = currentPrice;

    if (isBuy) {
      if (currentPrice >= signal.takeProfit) {
        status = SignalStatus.TP_HIT;
        exitPrice = signal.takeProfit;
      } else if (currentPrice <= signal.stopLoss) {
        status = SignalStatus.SL_HIT;
        exitPrice = signal.stopLoss;
      }
    } else {
      if (currentPrice <= signal.takeProfit) {
        status = SignalStatus.TP_HIT;
        exitPrice = signal.takeProfit;
      } else if (currentPrice >= signal.stopLoss) {
        status = SignalStatus.SL_HIT;
        exitPrice = signal.stopLoss;
      }
    }

    // 48 soatdan oshgan, TP/SL ga tegmagan signal — joriy narxda majburiy yopish
    if (!status && signal.createdAt < expiryCutoff) {
      exitPrice = currentPrice;
      const isFavorable = isBuy
        ? currentPrice > signal.entryPrice
        : currentPrice < signal.entryPrice;
      status = isFavorable ? SignalStatus.TP_HIT : SignalStatus.SL_HIT;
    }

    if (!status) continue;

    const resultPnlPct = isBuy
      ? ((exitPrice - signal.entryPrice) / signal.entryPrice) * 100
      : ((signal.entryPrice - exitPrice) / signal.entryPrice) * 100;

    await prisma.signal.update({
      where: { id: signal.id },
      data: { status, resultPnlPct: Number(resultPnlPct.toFixed(2)), closedAt: new Date() },
    });

    await closeTradesForSignal(signal.id, exitPrice, resultPnlPct);
  }

  await retryStuckRealTrades();
}

async function closeTradesForSignal(signalId: string, fallbackExitPrice: number, fallbackResultPnlPct: number) {
  const openTrades = await prisma.trade.findMany({
    where: { signalId, status: "OPEN" },
    include: { brokerAccount: true },
  });

  for (const trade of openTrades) {
    if (isRealExchangeTrade(trade)) {
      await closeRealExchangeTrade(trade, trade.brokerAccount!, fallbackExitPrice, fallbackResultPnlPct);
    } else {
      await closeSimulatedTrade(trade, fallbackExitPrice, fallbackResultPnlPct);
    }
  }
}

async function retryStuckRealTrades() {
  const stuck = await prisma.trade.findMany({
    where: {
      status: "OPEN",
      executionMode: { in: ["TESTNET", "LIVE"] },
      signal: { status: { in: [SignalStatus.TP_HIT, SignalStatus.SL_HIT] } },
    },
    include: { brokerAccount: true, signal: true },
  });

  for (const trade of stuck) {
    if (!isRealExchangeTrade(trade) || !trade.signal) continue;
    const fallbackExit = trade.signal.status === SignalStatus.TP_HIT ? trade.signal.takeProfit : trade.signal.stopLoss;
    await closeRealExchangeTrade(trade, trade.brokerAccount!, fallbackExit, trade.signal.resultPnlPct ?? 0);
  }
}

function isRealExchangeTrade(trade: { executionMode: string; brokerAccount: { exchange: string; isConnected: boolean } | null }): boolean {
  return (
    trade.executionMode !== "SIMULATED" &&
    !!trade.brokerAccount &&
    trade.brokerAccount.isConnected &&
    isRealExchangeIntegrated(trade.brokerAccount.exchange)
  );
}

export function decryptCredentials(account: { id: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted?: string | null }): ExchangeCredentials {
  return {
    apiKey: decryptSecret(account.apiKeyEncrypted, `${account.id}:apiKey`),
    apiSecret: decryptSecret(account.apiSecretEncrypted, `${account.id}:apiSecret`),
    passphrase: account.passphraseEncrypted ? decryptSecret(account.passphraseEncrypted, `${account.id}:passphrase`) : undefined,
  };
}

async function closeSimulatedTrade(
  trade: { id: string; userId: string; brokerAccountId: string | null; entryPrice: number; quantity: number; symbol: string; direction: string },
  exitPrice: number,
  resultPnlPct: number
) {
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

async function closeRealExchangeTrade(
  trade: { id: string; userId: string; symbol: string; direction: string; entryPrice: number; quantity: number; brokerAccountId: string | null },
  account: { id: string; exchange: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted: string | null },
  fallbackExitPrice: number,
  fallbackResultPnlPct: number
) {
  const adapter = getExchangeAdapter(account.exchange);
  if (!adapter) {
    await closeSimulatedTrade(trade, fallbackExitPrice, fallbackResultPnlPct);
    return;
  }

  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(account);
  } catch (err) {
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi:`, err instanceof Error ? err.message : err);
    await closeSimulatedTrade(trade, fallbackExitPrice, fallbackResultPnlPct);
    return;
  }

  try {
    const order = await adapter.placeMarketSell(creds, trade.symbol, trade.quantity);
    const exitPrice = order.avgPrice ?? fallbackExitPrice;

    // Actual PnL from real fill, minus estimated round-trip trading fees (~0.2% on Binance spot)
    const grossPnl = (exitPrice - trade.entryPrice) * trade.quantity;
    const feeUsd = exitPrice * trade.quantity * 0.002;
    const pnlUsd = Number((grossPnl - feeUsd).toFixed(2));

    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: "CLOSED", exitPrice, pnlUsd, closedAt: new Date(), externalOrderId: order.orderId },
    });

    await syncExchangeAccountBalance(adapter, account.id, creds);

    const modeLabel = exchangeMode() === "live" ? "REAL" : "TESTNET/sinov";
    await prisma.notification.create({
      data: {
        userId: trade.userId,
        title: pnlUsd >= 0 ? "Haqiqiy savdo foyda bilan yopildi" : "Haqiqiy savdo zarar bilan yopildi",
        message: `${trade.symbol} ${trade.direction} (${modeLabel}, ${adapter.id}) savdosi yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`,
      },
    });
  } catch (err) {
    console.error(`[AI Engine] ${adapter.id} yopish buyurtmasi xato (trade ${trade.id}):`, err instanceof Error ? err.message : err);
  }
}

async function syncExchangeAccountBalance(adapter: ExchangeAdapter, accountId: string, creds: ExchangeCredentials) {
  try {
    const usdtBalance = await adapter.fetchQuoteBalance(creds);
    await prisma.brokerAccount.update({ where: { id: accountId }, data: { balanceUsd: usdtBalance } });
  } catch (err) {
    console.error(`[AI Engine] Hisob ${accountId} balansini sinxronlashda xato:`, err instanceof Error ? err.message : err);
  }
}

export async function autoExecuteSignal(signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number; minPlan: PlanType }) {
  const planRank: Record<PlanType, number> = { FREE: 0, PRO: 1, ULTRA: 2, VIP: 3 };

  const accounts = await prisma.brokerAccount.findMany({
    where: { mode: "AUTO_TRADE", isConnected: true },
    include: { user: true },
  });

  for (const account of accounts) {
    if (!account.user.isActive) continue;
    if (planRank[account.user.plan as PlanType] < planRank[signal.minPlan]) continue;
    if (!PLAN_LIMITS[account.user.plan as PlanType]?.autoTradeAllowed) continue;

    const minConfidenceByRisk: Record<number, number> = { 1: 80, 2: 70, 3: 60 };
    if (signal.confidence < (minConfidenceByRisk[account.riskLevel] ?? 70)) continue;

    const riskFractionByLevel: Record<number, number> = { 1: 0.03, 2: 0.07, 3: 0.15 };
    const riskFraction = riskFractionByLevel[account.riskLevel] ?? 0.05;

    if (isRealExchangeIntegrated(account.exchange) && account.isConnected) {
      await openRealExchangeTrade(account, signal, riskFraction);
    } else {
      await openSimulatedTrade(account, signal, riskFraction);
    }
  }
}

async function openSimulatedTrade(
  account: { id: string; userId: string; balanceUsd: number },
  signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number },
  riskFraction: number
) {
  // Check deployed capital to prevent over-allocation
  const openTrades = await prisma.trade.findMany({
    where: { brokerAccountId: account.id, status: "OPEN" },
    select: { entryPrice: true, quantity: true },
  });
  const deployedUsd = openTrades.reduce((sum, t) => sum + t.entryPrice * t.quantity, 0);
  const availableBalance = Math.max(0, account.balanceUsd - deployedUsd);

  if (availableBalance < 5) {
    console.log(`[AI Engine] Hisob ${account.id}: yetarli erkin kapital yo'q ($${availableBalance.toFixed(2)})`);
    return;
  }

  const positionUsd = Math.min(availableBalance * riskFraction, availableBalance);
  if (positionUsd < 5) return;

  const quantity = Number((positionUsd / signal.entryPrice).toFixed(6));
  if (quantity <= 0) return;

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
      executionMode: "SIMULATED",
    },
  });

  await prisma.notification.create({
    data: {
      userId: account.userId,
      title: "AI yangi savdoni avtomatik ochdi",
      message: `${signal.symbol} bo'yicha ${signal.direction === "BUY" ? "xarid" : "sotish"} pozitsiyasi ochildi (ishonch: ${signal.confidence}%, ~$${positionUsd.toFixed(0)}).`,
    },
  });
}

async function openRealExchangeTrade(
  account: { id: string; userId: string; balanceUsd: number; exchange: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted: string | null },
  signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number },
  riskFraction: number
) {
  const adapter = getExchangeAdapter(account.exchange);
  if (!adapter) {
    await openSimulatedTrade(account, signal, riskFraction);
    return;
  }

  if (signal.direction !== SignalDirection.BUY) {
    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "SELL signali avtomatik bajarilmadi",
        message: `${signal.symbol} bo'yicha SELL signali paydo bo'ldi, ammo spot hisobda "shortlash" imkonsiz — mablag'ingiz xavfsiz qoldi. Signal sifatida saqlandi.`,
      },
    });
    return;
  }

  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(account);
  } catch (err) {
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi:`, err instanceof Error ? err.message : err);
    return;
  }

  const positionUsd = Math.max(account.balanceUsd * riskFraction, 10);
  const modeLabel = exchangeMode() === "live" ? "REAL" : "TESTNET (sinov)";

  try {
    const order = await adapter.placeMarketBuy(creds, signal.symbol, positionUsd);

    const fillPrice = order.avgPrice ?? signal.entryPrice;
    const executedQty = order.executedQty;
    if (!Number.isFinite(executedQty) || executedQty <= 0) {
      throw new Error(`${adapter.id} buyurtma bajarilgan miqdorni qaytarmadi`);
    }

    await prisma.trade.create({
      data: {
        userId: account.userId,
        brokerAccountId: account.id,
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: fillPrice,
        quantity: executedQty,
        executedByAi: true,
        status: "OPEN",
        executionMode: exchangeMode() === "live" ? "LIVE" : "TESTNET",
        externalOrderId: order.orderId,
      },
    });

    await syncExchangeAccountBalance(adapter, account.id, creds);

    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "AI haqiqiy buyurtma joylashtirdi",
        message: `${signal.symbol} bo'yicha ${modeLabel} (${adapter.id}) bozor buyurtmasi bajarildi: ${executedQty} dona, ~$${fillPrice} narxda (ishonch: ${signal.confidence}%).`,
      },
    });
  } catch (err) {
    console.error(`[AI Engine] ${adapter.id} ochish buyurtmasi xato (account ${account.id}):`, err instanceof Error ? err.message : err);
    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "AI buyurtmasi bajarilmadi",
        message: `${signal.symbol} bo'yicha avtomatik buyurtma bajarilmadi (API kalit, ruxsat yoki balans bilan bog'liq xatolik). Hisobingiz sozlamalarini tekshiring.`,
      },
    });
  }
}

let cycleRunning = false;

export async function runAiCycle() {
  if (cycleRunning) {
    console.warn("[AI Engine] Oldingi sikl hali tugalamagan, yangi sikl o'tkazib yuborildi");
    return;
  }
  cycleRunning = true;
  try {
    await evaluateOpenSignals();

    // Texnik tahlil har siklda ishga tushadi — signal faqat real ko'rsatkich bo'lganda yaratiladi
    const signal = await generateSignal();
    if (signal) {
      await autoExecuteSignal({
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction as SignalDirection,
        entryPrice: signal.entryPrice,
        confidence: signal.confidence,
        minPlan: signal.minPlan as PlanType,
      });
    }
  } finally {
    cycleRunning = false;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startAiEngine(intervalMs = 60_000) {
  if (intervalHandle) return;
  console.log(`AI Engine ishga tushdi (har ${intervalMs / 1000}s da bozorni tahlil qiladi, birja rejimi: ${exchangeMode().toUpperCase()})`);
  runAiCycle().catch((err) => console.error("AI cycle error:", err));
  intervalHandle = setInterval(() => {
    runAiCycle().catch((err) => console.error("AI cycle error:", err));
  }, intervalMs);
}

export function stopAiEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
