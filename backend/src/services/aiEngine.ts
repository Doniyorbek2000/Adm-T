import { PlanType, SignalDirection, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { decryptSecret } from "../utils/crypto";
import { exchangeMode, fetchSpotPrice } from "./exchanges/binance";
import { ExchangeAdapter, ExchangeCredentials, getExchangeAdapter, isRealExchangeIntegrated } from "./exchanges/registry";
import { PLAN_LIMITS } from "./planLimits";
import { isAiEnginePaused } from "./platformSettings";
import { checkTradeAllowed, computePositionSizeUsd, deployedCapitalUsd, getRiskProfile } from "./riskManager";
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

/** Taxminiy ikki tomonlama (kirish+chiqish) savdo komissiyasi */
const ROUND_TRIP_FEE_RATE = 0.002;

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
 * 48 soatdan oshgan signallar joriy narxda majburiy yopiladi (EXPIRED —
 * statistika buzilmasligi uchun TP/SL deb emas, alohida yozib boriladi).
 */
export async function evaluateOpenSignals() {
  // Avval birja tomonidagi OCO himoya buyurtmalari holatini sinxronlaymiz —
  // TP/SL birjada bajarilgan bo'lishi mumkin (server kuzatuvidan tezroq)
  await syncProtectedTrades();

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
        // SL'dan pastga sakragan bo'lsa, real chiqish joriy narxda bo'ladi —
        // optimistik emas, haqiqiy narxni yozamiz
        exitPrice = Math.min(currentPrice, signal.stopLoss);
      }
    } else {
      if (currentPrice <= signal.takeProfit) {
        status = SignalStatus.TP_HIT;
        exitPrice = signal.takeProfit;
      } else if (currentPrice >= signal.stopLoss) {
        status = SignalStatus.SL_HIT;
        exitPrice = Math.max(currentPrice, signal.stopLoss);
      }
    }

    // 48 soatdan oshgan, TP/SL ga tegmagan signal — joriy narxda majburiy yopish
    if (!status && signal.createdAt < expiryCutoff) {
      exitPrice = currentPrice;
      status = SignalStatus.EXPIRED;
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
      signal: { status: { in: [SignalStatus.TP_HIT, SignalStatus.SL_HIT, SignalStatus.EXPIRED] } },
    },
    include: { brokerAccount: true, signal: true },
  });

  for (const trade of stuck) {
    if (!isRealExchangeTrade(trade) || !trade.signal) continue;
    const fallbackExit =
      trade.signal.status === SignalStatus.TP_HIT ? trade.signal.takeProfit :
      trade.signal.status === SignalStatus.SL_HIT ? trade.signal.stopLoss :
      trade.entryPrice;
    await closeRealExchangeTrade(trade, trade.brokerAccount!, fallbackExit, trade.signal.resultPnlPct ?? 0);
  }
}

/**
 * Birja tomonidagi OCO (TP/SL) buyurtmalari holatini tekshiradi.
 * Bajarilgan bo'lsa — savdoni REAL chiqish narxi bilan yopadi.
 * Birjada qo'lda bekor qilingan bo'lsa — server kuzatuviga qaytaradi.
 */
async function syncProtectedTrades() {
  const trades = await prisma.trade.findMany({
    where: { status: "OPEN", ocoOrderListId: { not: null } },
    include: { brokerAccount: true },
  });

  for (const trade of trades) {
    const account = trade.brokerAccount;
    if (!account || !trade.ocoOrderListId) continue;

    const adapter = getExchangeAdapter(account.exchange);
    if (!adapter?.fetchProtectiveStatus) continue;

    let creds: ExchangeCredentials;
    try {
      creds = decryptCredentials(account);
    } catch {
      continue;
    }

    try {
      const status = await adapter.fetchProtectiveStatus(creds, trade.symbol, trade.ocoOrderListId);

      if (status.status === "FILLED") {
        await recordRealTradeClose(
          trade,
          account,
          adapter,
          creds,
          status.exitPrice ?? trade.entryPrice,
          status.executedQty > 0 ? status.executedQty : trade.quantity,
          null,
          "Himoya buyurtmasi (birja tomonidagi TP/SL) bajarildi"
        );
      } else if (status.status === "CANCELED") {
        await prisma.trade.update({ where: { id: trade.id }, data: { ocoOrderListId: null } });
        console.warn(`[AI Engine] Trade ${trade.id}: OCO birjada bekor qilingan — server kuzatuviga qaytarildi`);
      }
    } catch (err) {
      console.error(`[AI Engine] Trade ${trade.id} OCO holatini tekshirishda xato:`, err instanceof Error ? err.message : err);
    }
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

interface RealTradeRow {
  id: string;
  userId: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  quantity: number;
  brokerAccountId: string | null;
  ocoOrderListId?: string | null;
}

interface RealAccountRow {
  id: string;
  exchange: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted: string;
  passphraseEncrypted: string | null;
}

/** Yopilgan real savdoni DB'ga yozish, balansni sinxronlash va xabarnoma */
export async function recordRealTradeClose(
  trade: RealTradeRow,
  account: RealAccountRow,
  adapter: ExchangeAdapter,
  creds: ExchangeCredentials,
  exitPrice: number,
  soldQty: number,
  externalOrderId: string | null,
  closeReason: string
): Promise<{ exitPrice: number; pnlUsd: number }> {
  const grossPnl = (exitPrice - trade.entryPrice) * soldQty;
  const feeUsd = Number((exitPrice * soldQty * ROUND_TRIP_FEE_RATE).toFixed(2));
  const pnlUsd = Number((grossPnl - feeUsd).toFixed(2));

  await prisma.trade.update({
    where: { id: trade.id },
    data: {
      status: "CLOSED",
      exitPrice,
      pnlUsd,
      feeUsd,
      closedAt: new Date(),
      ...(externalOrderId ? { externalOrderId } : {}),
    },
  });

  await syncExchangeAccountBalance(adapter, account.id, creds);

  const modeLabel = exchangeMode() === "live" ? "REAL" : "TESTNET/sinov";
  await prisma.notification.create({
    data: {
      userId: trade.userId,
      title: pnlUsd >= 0 ? "Haqiqiy savdo foyda bilan yopildi" : "Haqiqiy savdo zarar bilan yopildi",
      message: `${trade.symbol} ${trade.direction} (${modeLabel}, ${adapter.id}) savdosi yopildi — ${closeReason}. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`,
    },
  });

  return { exitPrice, pnlUsd };
}

async function closeRealExchangeTrade(
  trade: RealTradeRow,
  account: RealAccountRow,
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

  // OCO himoyasi bo'lsa — market-sell'dan OLDIN uni hal qilamiz, aks holda
  // ikki marta sotib qo'yishimiz mumkin (OCO ham, market-sell ham bajarilib)
  if (trade.ocoOrderListId && adapter.cancelProtectiveOrders && adapter.fetchProtectiveStatus) {
    try {
      const cancelResult = await adapter.cancelProtectiveOrders(creds, trade.symbol, trade.ocoOrderListId);
      if (cancelResult === "already_done") {
        const status = await adapter.fetchProtectiveStatus(creds, trade.symbol, trade.ocoOrderListId);
        if (status.status === "FILLED") {
          await recordRealTradeClose(
            trade, account, adapter, creds,
            status.exitPrice ?? fallbackExitPrice,
            status.executedQty > 0 ? status.executedQty : trade.quantity,
            null,
            "birja tomonidagi TP/SL bajarilgan edi"
          );
          return;
        }
        // CANCELED bo'lsa — davom etamiz (market-sell bilan yopamiz)
      }
    } catch (err) {
      console.error(`[AI Engine] Trade ${trade.id} OCO'ni bekor qilishda xato:`, err instanceof Error ? err.message : err);
      // Ehtiyot: OCO holati noaniq bo'lsa, market-sell yubormaymiz — keyingi
      // siklda syncProtectedTrades yoki retryStuckRealTrades qayta urinadi
      return;
    }
  }

  try {
    const order = await adapter.placeMarketSell(creds, trade.symbol, trade.quantity);
    const exitPrice = order.avgPrice ?? fallbackExitPrice;
    await recordRealTradeClose(trade, account, adapter, creds, exitPrice, trade.quantity, order.orderId, "bozor buyurtmasi bilan yopildi");
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

export interface ExecutableSignal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  minPlan: PlanType;
}

export async function autoExecuteSignal(signal: ExecutableSignal) {
  const planRank: Record<PlanType, number> = { FREE: 0, PRO: 1, ULTRA: 2, VIP: 3 };

  const accounts = await prisma.brokerAccount.findMany({
    where: { mode: "AUTO_TRADE", isConnected: true },
    include: { user: true },
  });

  for (const account of accounts) {
    if (!account.user.isActive) continue;
    if (planRank[account.user.plan as PlanType] < planRank[signal.minPlan]) continue;
    if (!PLAN_LIMITS[account.user.plan as PlanType]?.autoTradeAllowed) continue;

    const profile = getRiskProfile(account.riskLevel);
    if (signal.confidence < profile.minConfidence) continue;

    // Risk-menejment darvozasi: ochiq pozitsiyalar soni, takroriy simvol,
    // kunlik zarar limiti
    const gate = await checkTradeAllowed({
      accountId: account.id,
      symbol: signal.symbol,
      balanceUsd: account.balanceUsd,
      riskLevel: account.riskLevel,
    });
    if (!gate.allowed) {
      console.log(`[Risk] Hisob ${account.id}: ${gate.reason}`);
      continue;
    }

    if (isRealExchangeIntegrated(account.exchange) && account.isConnected) {
      await openRealExchangeTrade(account, signal);
    } else {
      await openSimulatedTrade(account, signal);
    }
  }
}

async function openSimulatedTrade(
  account: { id: string; userId: string; balanceUsd: number; riskLevel: number },
  signal: ExecutableSignal
) {
  const profile = getRiskProfile(account.riskLevel);
  const deployedUsd = await deployedCapitalUsd(account.id);
  const availableUsd = Math.max(0, account.balanceUsd - deployedUsd);

  const positionUsd = computePositionSizeUsd({
    balanceUsd: account.balanceUsd,
    availableUsd,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    riskPerTradeFraction: profile.riskPerTradeFraction,
  });

  if (positionUsd <= 0) {
    console.log(`[AI Engine] Hisob ${account.id}: pozitsiya o'lchami juda kichik (erkin: $${availableUsd.toFixed(2)})`);
    return;
  }

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
      message: `${signal.symbol} bo'yicha ${signal.direction === "BUY" ? "xarid" : "sotish"} pozitsiyasi ochildi (ishonch: ${signal.confidence}%, ~$${positionUsd.toFixed(0)}, risk: balansning ${(profile.riskPerTradeFraction * 100).toFixed(1)}%).`,
    },
  });
}

async function openRealExchangeTrade(
  account: { id: string; userId: string; balanceUsd: number; riskLevel: number; exchange: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted: string | null },
  signal: ExecutableSignal
) {
  const adapter = getExchangeAdapter(account.exchange);
  if (!adapter) {
    await openSimulatedTrade(account, signal);
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

  const profile = getRiskProfile(account.riskLevel);
  const deployedUsd = await deployedCapitalUsd(account.id);
  const availableUsd = Math.max(0, account.balanceUsd - deployedUsd);

  const positionUsd = computePositionSizeUsd({
    balanceUsd: account.balanceUsd,
    availableUsd,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    riskPerTradeFraction: profile.riskPerTradeFraction,
  });

  if (positionUsd <= 0) {
    console.log(`[AI Engine] Hisob ${account.id}: real savdo uchun pozitsiya o'lchami yetarli emas (erkin: $${availableUsd.toFixed(2)})`);
    return;
  }

  const modeLabel = exchangeMode() === "live" ? "REAL" : "TESTNET (sinov)";

  try {
    const order = await adapter.placeMarketBuy(creds, signal.symbol, positionUsd);

    const fillPrice = order.avgPrice ?? signal.entryPrice;
    const executedQty = order.executedQty;
    if (!Number.isFinite(executedQty) || executedQty <= 0) {
      throw new Error(`${adapter.id} buyurtma bajarilgan miqdorni qaytarmadi`);
    }

    // Komissiya ayirilgandan keyin sotish mumkin bo'lgan miqdor
    const netQty = order.sellableQty && order.sellableQty > 0 ? order.sellableQty : executedQty;

    // Birja tomonidagi himoya (OCO TP/SL) — server o'chsa ham pozitsiya himoyalanadi
    let ocoOrderListId: string | null = null;
    let protectedQty = netQty;
    if (adapter.placeProtectiveOrders) {
      try {
        const oco = await adapter.placeProtectiveOrders(creds, signal.symbol, netQty, signal.takeProfit, signal.stopLoss);
        ocoOrderListId = oco.listId;
        protectedQty = oco.quantity;
      } catch (err) {
        console.error(`[AI Engine] ${adapter.id} OCO joylashtirishda xato (account ${account.id}):`, err instanceof Error ? err.message : err);
      }
    }

    await prisma.trade.create({
      data: {
        userId: account.userId,
        brokerAccountId: account.id,
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: fillPrice,
        quantity: ocoOrderListId ? protectedQty : netQty,
        executedByAi: true,
        status: "OPEN",
        executionMode: exchangeMode() === "live" ? "LIVE" : "TESTNET",
        externalOrderId: order.orderId,
        ocoOrderListId,
      },
    });

    await syncExchangeAccountBalance(adapter, account.id, creds);

    const protectionNote = ocoOrderListId
      ? "TP/SL birja tomonida o'rnatildi (OCO)."
      : "TP/SL server tomonida kuzatiladi.";
    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "AI haqiqiy buyurtma joylashtirdi",
        message: `${signal.symbol} bo'yicha ${modeLabel} (${adapter.id}) bozor buyurtmasi bajarildi: ${executedQty} dona, ~$${fillPrice} narxda (ishonch: ${signal.confidence}%). ${protectionNote}`,
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
    // Ochiq pozitsiyalarni kuzatish/yopish HAR DOIM ishlaydi — kill-switch
    // faqat YANGI savdolarni to'xtatadi (himoya to'xtamasligi kerak)
    await evaluateOpenSignals();

    if (await isAiEnginePaused()) {
      console.log("[AI Engine] Kill-switch yoqilgan — yangi signal/savdo ochilmaydi (ochiq pozitsiyalar kuzatuvda)");
      return;
    }

    // Texnik tahlil har siklda ishga tushadi — signal faqat real ko'rsatkich bo'lganda yaratiladi
    const signal = await generateSignal();
    if (signal) {
      await autoExecuteSignal({
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction as SignalDirection,
        entryPrice: signal.entryPrice,
        takeProfit: signal.takeProfit,
        stopLoss: signal.stopLoss,
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
