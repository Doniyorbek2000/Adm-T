import { PlanType, SignalDirection, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { decryptSecret } from "../utils/crypto";
import { env } from "../utils/env";
import { exchangeMode, fetchSpreadPct, floorToStep, MAX_ENTRY_SPREAD_PCT } from "./exchanges/binance";
import {
  futuresAvailableUsdt,
  futuresCancelAllOrders,
  futuresClosePosition,
  futuresGetFilters,
  futuresOpenPosition,
  futuresPlaceProtection,
  futuresPositionAmt,
  futuresRealizedPnl,
  futuresSetLeverage,
  futuresTotalUsdt,
} from "./exchanges/binanceFutures";
import { ExchangeAdapter, ExchangeCredentials, getExchangeAdapter, isRealExchangeIntegrated } from "./exchanges/registry";
import { applyContextToSignal, fetchFundingRate, getMarketContext } from "./marketContext";
import { notifyUser, sendTelegram } from "./notifier";
import { getCachedPrice, getPrice, startPriceFeed, stopPriceFeed } from "./priceFeed";
import { PLAN_LIMITS } from "./planLimits";
import { getSetting, isAiEnginePaused, setSetting } from "./platformSettings";
import {
  checkTradeAllowed,
  computePositionSizeUsd,
  computeTrailedStop,
  deployedCapitalUsd,
  getRiskProfile,
  isEntryStillValid,
} from "./riskManager";
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
 * RSI, MACD, EMA, BB, Stochastic, ATR + 4h trend (ADX) filtri va hajm
 * tasdig'idan foydalanadi. Tasodifiy emas — real bozor ma'lumotlariga asoslangan.
 */
export async function generateSignal() {
  const result = await findBestSignal(SYMBOLS);

  // Agar hech qanday kuchli signal topilmasa — null qaytarish (bu siklda signal yaratilmaydi)
  if (!result) {
    console.log("[AI Engine] Bu siklda kuchli signal topilmadi (bozor neytral)");
    return null;
  }

  const { symbol, signal: ta } = result;

  // Bozor konteksti filtri: Fear&Greed, BTC momentum, funding rate.
  // Texnik jihatdan kuchli, ammo bozor sharoitida xavfli signallar bloklanadi.
  let confidence = ta.confidence;
  let contextNotes = "";
  try {
    const ctx = await getMarketContext();
    const fundingRate = ta.direction !== "HOLD" ? await fetchFundingRate(symbol) : null;
    const decision = applyContextToSignal({
      direction: ta.direction as "BUY" | "SELL",
      confidence: ta.confidence,
      symbol,
      ctx,
      fundingRate,
    });

    if (!decision.allowed) {
      console.log(`[AI Engine] ${symbol} ${ta.direction} signali kontekst filtri bilan bloklandi: ${decision.blockReason}`);
      return null;
    }
    confidence = decision.confidence;
    if (decision.notes.length > 0) contextNotes = "; " + decision.notes.join("; ");
  } catch (err) {
    // Kontekst olinmasa signal texnik tahlil bo'yicha davom etadi
    console.warn("[AI Engine] Bozor kontekstini olishda xato:", err instanceof Error ? err.message : err);
  }

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
      analysis:   ta.analysis + contextNotes,
      minPlan,
      status: SignalStatus.ACTIVE,
    },
  });

  return signal;
}

/**
 * Faol signallarni HAQIQIY Binance narxi bilan solishtirib yopadi.
 * TP/SL darajasiga narx yetganda — yopiladi. 48 soatdan oshgan signallar
 * joriy narxda majburiy yopiladi (EXPIRED status bilan).
 */
export async function evaluateOpenSignals() {
  // 1) Birja tomonidagi himoyalar holati: spot OCO va futures pozitsiyalari
  await syncProtectedTrades();
  await syncFuturesTrades();

  // 2) Break-even / trailing stop boshqaruvi va per-trade yopishlar
  await manageOpenTrades();

  const minAgeCutoff  = new Date(Date.now() - 3 * 60 * 1000);
  const expiryCutoff  = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const activeSignals = await prisma.signal.findMany({
    where: { status: SignalStatus.ACTIVE, createdAt: { lte: minAgeCutoff } },
  });

  for (const signal of activeSignals) {
    const isBuy = signal.direction === SignalDirection.BUY;

    let currentPrice: number;
    try {
      currentPrice = await getPrice(signal.symbol);
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
    if (trade.marketType === "FUTURES" && trade.brokerAccount) {
      await closeFuturesTradeAndRecord(trade, trade.brokerAccount, "signal yopildi");
    } else if (isRealExchangeTrade(trade)) {
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
    if (!trade.brokerAccount || !trade.signal) continue;
    if (trade.marketType === "FUTURES") {
      await closeFuturesTradeAndRecord(trade, trade.brokerAccount, "signal yopilgan (qayta urinish)");
      continue;
    }
    if (!isRealExchangeTrade(trade)) continue;
    const fallbackExit =
      trade.signal.status === SignalStatus.TP_HIT ? trade.signal.takeProfit :
      trade.signal.status === SignalStatus.SL_HIT ? trade.signal.stopLoss :
      trade.entryPrice;
    await closeRealExchangeTrade(trade, trade.brokerAccount, fallbackExit, trade.signal.resultPnlPct ?? 0);
  }
}

/**
 * Birja tomonidagi spot OCO (TP/SL) buyurtmalari holatini tekshiradi.
 * Bajarilgan bo'lsa — savdoni REAL chiqish narxi bilan yopadi.
 * Birjada qo'lda bekor qilingan bo'lsa — server kuzatuviga qaytaradi.
 */
async function syncProtectedTrades() {
  const trades = await prisma.trade.findMany({
    where: { status: "OPEN", ocoOrderListId: { not: null }, marketType: "SPOT" },
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

/**
 * Futures pozitsiyalarini sinxronlaydi: birja tomonidagi TP/SL ishlagan
 * bo'lsa (pozitsiya = 0), haqiqiy realized PnL bilan DB'da yopadi va qolgan
 * himoya buyurtmasini tozalaydi.
 */
async function syncFuturesTrades() {
  const trades = await prisma.trade.findMany({
    where: { status: "OPEN", marketType: "FUTURES" },
    include: { brokerAccount: true },
  });

  for (const trade of trades) {
    const account = trade.brokerAccount;
    if (!account) continue;

    let creds: ExchangeCredentials;
    try {
      creds = decryptCredentials(account);
    } catch {
      continue;
    }

    try {
      const amt = await futuresPositionAmt(creds, trade.symbol);
      const expectedSign = trade.direction === "BUY" ? 1 : -1;
      const stillOpen = Math.abs(amt) > 1e-9 && Math.sign(amt) === expectedSign;
      if (stillOpen) continue;

      // Pozitsiya birjada yopilgan (TP yoki SL ishlagan) — tozalash va yozish
      try {
        await futuresCancelAllOrders(creds, trade.symbol);
      } catch {
        // qoldiq buyurtma bo'lmasligi mumkin — muammo emas
      }

      const realized = await futuresRealizedPnl(creds, trade.symbol, trade.openedAt.getTime() - 1000);
      const pnlUsd = Number((realized.pnlUsd - realized.feeUsd).toFixed(2));
      const exitPrice = realized.lastPrice ?? trade.stopLossPrice ?? trade.entryPrice;

      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "CLOSED", exitPrice, pnlUsd, feeUsd: realized.feeUsd, closedAt: new Date() },
      });

      await syncFuturesAccountBalance(account.id, creds);

      await notifyUser(
        trade.userId,
        pnlUsd >= 0 ? "Futures savdosi foyda bilan yopildi" : "Futures savdosi zarar bilan yopildi",
        `${trade.symbol} ${trade.direction === "BUY" ? "LONG" : "SHORT"} pozitsiyasi birja tomonidagi TP/SL bilan yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`
      );
    } catch (err) {
      console.error(`[AI Engine] Futures trade ${trade.id} sinxronlashda xato:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Ochiq savdolarni faol boshqarish:
 *  1) SIMULATED va himoyasiz real savdolarni o'zining (ehtimol ko'chirilgan)
 *     TP/SL darajalariga qarab yopish
 *  2) Break-even: 1R foydada SL zararsiz nuqtaga ko'chiriladi
 *  3) Trailing: undan keyin SL narxdan 1R orqada ergashadi
 * Birja tomonidagi himoyalar (spot OCO / futures) yangi SL bilan qayta
 * joylashtiriladi.
 */
async function manageOpenTrades(options: { cacheOnly?: boolean } = {}) {
  const trades = await prisma.trade.findMany({
    where: { status: "OPEN", stopLossPrice: { not: null }, takeProfitPrice: { not: null } },
    include: { brokerAccount: true, signal: true },
  });
  if (trades.length === 0) return;

  // Har simvol uchun narxni bir marta olish. cacheOnly rejimida (tezkor
  // himoya sikli, 10s) faqat WebSocket keshi ishlatiladi — REST so'rov yo'q
  const prices = new Map<string, number>();
  for (const symbol of new Set(trades.map((t) => t.symbol))) {
    if (options.cacheOnly) {
      const cached = getCachedPrice(symbol);
      if (cached !== null) prices.set(symbol, cached);
      continue;
    }
    try {
      prices.set(symbol, await getPrice(symbol));
    } catch {
      // narx olinmasa bu simvol savdolari keyingi siklda boshqariladi
    }
  }

  for (const trade of trades) {
    const price = prices.get(trade.symbol);
    if (!price || !trade.stopLossPrice || !trade.takeProfitPrice) continue;

    const isBuy = trade.direction === "BUY";
    const sl = trade.stopLossPrice;
    const tp = trade.takeProfitPrice;

    // ── 1) Per-trade TP/SL yopish (faqat birja himoyasi YO'Q savdolar uchun;
    //       himoyali savdolarni birjaning o'zi yopadi, sync bosqichi yozadi)
    const hasExchangeProtection = !!trade.ocoOrderListId;
    if (!hasExchangeProtection) {
      let exitPrice: number | null = null;
      if (isBuy) {
        if (price <= sl) exitPrice = Math.min(price, sl);
        else if (price >= tp) exitPrice = tp;
      } else {
        if (price >= sl) exitPrice = Math.max(price, sl);
        else if (price <= tp) exitPrice = tp;
      }

      if (exitPrice !== null) {
        const pnlPct = isBuy
          ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;

        if (trade.marketType === "FUTURES" && trade.brokerAccount) {
          await closeFuturesTradeAndRecord(trade, trade.brokerAccount, "TP/SL darajasiga yetdi");
        } else if (isRealExchangeTrade(trade)) {
          await closeRealExchangeTrade(trade, trade.brokerAccount!, exitPrice, pnlPct);
        } else {
          await closeSimulatedTrade(trade, exitPrice, pnlPct);
        }
        continue;
      }
    }

    // ── 2) Break-even / trailing
    const initialSl = trade.signal?.stopLoss;
    if (!initialSl) continue;

    const advice = computeTrailedStop({
      direction: isBuy ? "BUY" : "SELL",
      entryPrice: trade.entryPrice,
      initialStopLoss: initialSl,
      currentStopLoss: sl,
      currentPrice: price,
      breakEvenApplied: trade.breakEvenApplied,
    });
    if (!advice) continue;

    const applied = await applyNewStopLoss(trade, advice.newStopLoss);
    if (applied) {
      const label = advice.reason === "BREAK_EVEN" ? "zararsiz nuqtaga (break-even)" : "trailing bo'yicha";
      console.log(`[AI Engine] Trade ${trade.id}: SL ${label} ko'chirildi → ${advice.newStopLoss}`);
      if (advice.reason === "BREAK_EVEN") {
        await notifyUser(
          trade.userId,
          "Stop-loss zararsiz nuqtaga ko'chirildi",
          `${trade.symbol} ${isBuy ? "LONG" : "SHORT"} savdosi +1R foydaga yetdi — endi bu savdo zarar bilan yopilishi mumkin emas.`
        );
      }
    }
  }
}

/** Yangi SL'ni savdo turiga qarab qo'llaydi (birja himoyasini qayta joylashtirish bilan) */
async function applyNewStopLoss(
  trade: {
    id: string; symbol: string; direction: string; quantity: number;
    marketType: string; executionMode: string; ocoOrderListId: string | null;
    takeProfitPrice: number | null; stopLossPrice: number | null;
    brokerAccount: RealAccountRow | null;
  },
  newStopLoss: number
): Promise<boolean> {
  const isBuy = trade.direction === "BUY";
  const tp = trade.takeProfitPrice!;

  // SIMULATED yoki birja himoyasisiz real savdo — faqat DB yangilanadi
  if (trade.marketType === "SPOT" && (trade.executionMode === "SIMULATED" || !trade.ocoOrderListId)) {
    await prisma.trade.update({
      where: { id: trade.id },
      data: { stopLossPrice: newStopLoss, breakEvenApplied: true },
    });
    return true;
  }

  if (!trade.brokerAccount) return false;

  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(trade.brokerAccount);
  } catch {
    return false;
  }

  // FUTURES: eski himoyani bekor qilib, yangi SL bilan qayta joylashtirish
  if (trade.marketType === "FUTURES") {
    try {
      const filters = await futuresGetFilters(trade.symbol);
      await futuresCancelAllOrders(creds, trade.symbol);
      const protection = await futuresPlaceProtection(
        creds,
        trade.symbol,
        isBuy ? "BUY" : "SELL",
        floorToStep(tp, filters.tickSize),
        floorToStep(newStopLoss, filters.tickSize)
      );
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          stopLossPrice: newStopLoss,
          breakEvenApplied: true,
          ocoOrderListId: `F:${protection.tpOrderId}:${protection.slOrderId}`,
        },
      });
      return true;
    } catch (err) {
      console.error(`[AI Engine] Trade ${trade.id}: futures himoyani ko'chirishda xato:`, err instanceof Error ? err.message : err);
      // Eski darajalar bilan qayta joylashtirishga urinish — pozitsiya himoyasiz qolmasin
      try {
        const filters = await futuresGetFilters(trade.symbol);
        await futuresPlaceProtection(
          creds, trade.symbol, isBuy ? "BUY" : "SELL",
          floorToStep(tp, filters.tickSize),
          floorToStep(trade.stopLossPrice!, filters.tickSize)
        );
      } catch (err2) {
        console.error(`[AI Engine] KRITIK: trade ${trade.id} futures pozitsiyasi himoyasiz qoldi:`, err2 instanceof Error ? err2.message : err2);
        await prisma.trade.update({ where: { id: trade.id }, data: { ocoOrderListId: null } });
      }
      return false;
    }
  }

  // SPOT OCO: bekor qilib, yangi SL bilan qayta joylashtirish
  const adapter = getExchangeAdapter(trade.brokerAccount.exchange);
  if (!adapter?.cancelProtectiveOrders || !adapter.placeProtectiveOrders || !trade.ocoOrderListId) return false;

  try {
    const cancelResult = await adapter.cancelProtectiveOrders(creds, trade.symbol, trade.ocoOrderListId);
    if (cancelResult === "already_done") return false; // sync bosqichi yopadi

    const oco = await adapter.placeProtectiveOrders(creds, trade.symbol, trade.quantity, tp, newStopLoss);
    await prisma.trade.update({
      where: { id: trade.id },
      data: { stopLossPrice: newStopLoss, breakEvenApplied: true, ocoOrderListId: oco.listId },
    });
    return true;
  } catch (err) {
    console.error(`[AI Engine] Trade ${trade.id}: OCO'ni ko'chirishda xato:`, err instanceof Error ? err.message : err);
    // OCO bekor qilingan, yangisi joylashmagan bo'lishi mumkin — server kuzatuviga o'tkazamiz
    await prisma.trade.update({ where: { id: trade.id }, data: { ocoOrderListId: null, stopLossPrice: newStopLoss, breakEvenApplied: true } });
    return true;
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

  await notifyUser(
    trade.userId,
    pnlUsd >= 0 ? "AI savdosi foyda bilan yopildi" : "AI savdosi zarar bilan yopildi",
    `${trade.symbol} ${trade.direction} savdosi yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$`
  );
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
  await notifyUser(
    trade.userId,
    pnlUsd >= 0 ? "Haqiqiy savdo foyda bilan yopildi" : "Haqiqiy savdo zarar bilan yopildi",
    `${trade.symbol} ${trade.direction} (${modeLabel}, ${adapter.id}) savdosi yopildi — ${closeReason}. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`
  );

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

/**
 * Futures savdosini yopish va natijani yozish (signal yopilishi, qo'lda
 * yopish yoki TP/SL darajasi uchun umumiy yo'l). Pozitsiya allaqachon birjada
 * yopilgan bo'lsa, faqat realized natija yoziladi.
 */
export async function closeFuturesTradeAndRecord(
  trade: { id: string; userId: string; symbol: string; direction: string; entryPrice: number; quantity: number; openedAt: Date },
  account: RealAccountRow,
  closeReason: string
): Promise<{ exitPrice: number; pnlUsd: number } | null> {
  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(account);
  } catch (err) {
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi:`, err instanceof Error ? err.message : err);
    return null;
  }

  try {
    // Avval himoya buyurtmalarini tozalash — yopish paytida TP/SL ishlab
    // qo'shimcha pozitsiya ochilmasligi uchun
    try {
      await futuresCancelAllOrders(creds, trade.symbol);
    } catch {
      // ochiq buyurtma bo'lmasligi mumkin
    }

    const amt = await futuresPositionAmt(creds, trade.symbol);
    const expectedSign = trade.direction === "BUY" ? 1 : -1;
    if (Math.abs(amt) > 1e-9 && Math.sign(amt) === expectedSign) {
      await futuresClosePosition(creds, trade.symbol, trade.direction as "BUY" | "SELL", Math.abs(amt));
    }

    const realized = await futuresRealizedPnl(creds, trade.symbol, trade.openedAt.getTime() - 1000);
    const pnlUsd = Number((realized.pnlUsd - realized.feeUsd).toFixed(2));
    const exitPrice = realized.lastPrice ?? trade.entryPrice;

    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: "CLOSED", exitPrice, pnlUsd, feeUsd: realized.feeUsd, closedAt: new Date() },
    });

    await syncFuturesAccountBalance(account.id, creds);

    await notifyUser(
      trade.userId,
      pnlUsd >= 0 ? "Futures savdosi foyda bilan yopildi" : "Futures savdosi zarar bilan yopildi",
      `${trade.symbol} ${trade.direction === "BUY" ? "LONG" : "SHORT"} pozitsiyasi yopildi — ${closeReason}. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`
    );

    return { exitPrice, pnlUsd };
  } catch (err) {
    console.error(`[AI Engine] Futures trade ${trade.id} yopishda xato:`, err instanceof Error ? err.message : err);
    return null;
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

async function syncFuturesAccountBalance(accountId: string, creds: ExchangeCredentials) {
  try {
    const total = await futuresTotalUsdt(creds);
    await prisma.brokerAccount.update({ where: { id: accountId }, data: { balanceUsd: total } });
  } catch (err) {
    console.error(`[AI Engine] Hisob ${accountId} futures balansini sinxronlashda xato:`, err instanceof Error ? err.message : err);
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

    if (account.exchange === "Binance" && account.marketType === "FUTURES") {
      // Futures: BUY (long) ham, SELL (short) ham bajariladi
      await openFuturesTrade(account, signal);
    } else if (isRealExchangeIntegrated(account.exchange) && account.isConnected) {
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
      stopLossPrice: signal.stopLoss,
      takeProfitPrice: signal.takeProfit,
    },
  });

  await notifyUser(
    account.userId,
    "AI yangi savdoni avtomatik ochdi",
    `${signal.symbol} bo'yicha ${signal.direction === "BUY" ? "xarid" : "sotish"} pozitsiyasi ochildi (ishonch: ${signal.confidence}%, ~$${positionUsd.toFixed(0)}, risk: balansning ${(profile.riskPerTradeFraction * 100).toFixed(1)}%).`
  );
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
    await notifyUser(
      account.userId,
      "SELL signali spot hisobda bajarilmadi",
      `${signal.symbol} bo'yicha SELL signali paydo bo'ldi, ammo spot hisobda "shortlash" imkonsiz. SELL signallarini ham avtomatik bajarish uchun hisobni FUTURES rejimiga o'tkazing.`
    );
    return;
  }

  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(account);
  } catch (err) {
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi:`, err instanceof Error ? err.message : err);
    return;
  }

  // Kirish hali dolzarbmi? Narx signal yaratilgandan beri qochib ketgan
  // bo'lsa, eskirgan narxda kirish — yutqazuvchi o'yin
  let currentPrice = signal.entryPrice;
  try {
    currentPrice = getCachedPrice(signal.symbol) ?? (await adapter.fetchPrice(signal.symbol));
  } catch {
    // narx olinmasa signal narxi bilan davom etamiz
  }
  if (!isEntryStillValid(signal.direction, signal.entryPrice, signal.takeProfit, signal.stopLoss, currentPrice)) {
    console.log(`[AI Engine] Hisob ${account.id}: ${signal.symbol} kirish eskirgan (signal: ${signal.entryPrice}, joriy: ${currentPrice}) — savdo ochilmadi`);
    return;
  }

  // Likvidlik nazorati: spread keng bo'lsa market buyurtma yomon to'ldiriladi
  const spreadPct = await fetchSpreadPct(signal.symbol);
  if (spreadPct !== null && spreadPct > MAX_ENTRY_SPREAD_PCT) {
    console.log(`[AI Engine] Hisob ${account.id}: ${signal.symbol} spread ${spreadPct}% > ${MAX_ENTRY_SPREAD_PCT}% — likvidlik past, savdo ochilmadi`);
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
        stopLossPrice: signal.stopLoss,
        takeProfitPrice: signal.takeProfit,
      },
    });

    await syncExchangeAccountBalance(adapter, account.id, creds);

    const protectionNote = ocoOrderListId
      ? "TP/SL birja tomonida o'rnatildi (OCO)."
      : "TP/SL server tomonida kuzatiladi.";
    await notifyUser(
      account.userId,
      "AI haqiqiy buyurtma joylashtirdi",
      `${signal.symbol} bo'yicha ${modeLabel} (${adapter.id}) bozor buyurtmasi bajarildi: ${executedQty} dona, ~$${fillPrice} narxda (ishonch: ${signal.confidence}%). ${protectionNote}`
    );
  } catch (err) {
    console.error(`[AI Engine] ${adapter.id} ochish buyurtmasi xato (account ${account.id}):`, err instanceof Error ? err.message : err);
    await notifyUser(
      account.userId,
      "AI buyurtmasi bajarilmadi",
      `${signal.symbol} bo'yicha avtomatik buyurtma bajarilmadi (API kalit, ruxsat yoki balans bilan bog'liq xatolik). Hisobingiz sozlamalarini tekshiring.`
    );
  }
}

/**
 * Binance USDT-M Futures'da pozitsiya ochish: BUY = long, SELL = short.
 * Har pozitsiyaga darhol birja tomonida TP/SL (closePosition) qo'yiladi;
 * himoya joylashmasa pozitsiya DARHOL yopiladi — himoyasiz pozitsiya yo'q.
 */
async function openFuturesTrade(
  account: { id: string; userId: string; balanceUsd: number; riskLevel: number; exchange: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted: string | null },
  signal: ExecutableSignal
) {
  let creds: ExchangeCredentials;
  try {
    creds = decryptCredentials(account);
  } catch (err) {
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi:`, err instanceof Error ? err.message : err);
    return;
  }

  // Kirish dolzarbligini tekshirish
  let currentPrice = signal.entryPrice;
  try {
    currentPrice = await getPrice(signal.symbol);
  } catch {
    // narx olinmasa signal narxi bilan davom etamiz
  }
  if (!isEntryStillValid(signal.direction, signal.entryPrice, signal.takeProfit, signal.stopLoss, currentPrice)) {
    console.log(`[AI Engine] Hisob ${account.id}: ${signal.symbol} futures kirish eskirgan — savdo ochilmadi`);
    return;
  }

  // Likvidlik nazorati (spot spread futures uchun ham yaxshi indikator)
  const spreadPct = await fetchSpreadPct(signal.symbol);
  if (spreadPct !== null && spreadPct > MAX_ENTRY_SPREAD_PCT) {
    console.log(`[AI Engine] Hisob ${account.id}: ${signal.symbol} spread ${spreadPct}% — likvidlik past, futures savdo ochilmadi`);
    return;
  }

  const profile = getRiskProfile(account.riskLevel);

  try {
    const availableMargin = await futuresAvailableUsdt(creds);
    const equity = await futuresTotalUsdt(creds).catch(() => availableMargin);

    // Notional sig'im = erkin marja × leverage; risk baribir SL masofasidan
    const positionUsd = computePositionSizeUsd({
      balanceUsd: equity,
      availableUsd: availableMargin * env.futuresLeverage,
      entryPrice: currentPrice,
      stopLoss: signal.stopLoss,
      riskPerTradeFraction: profile.riskPerTradeFraction,
    });

    if (positionUsd <= 0) {
      console.log(`[AI Engine] Hisob ${account.id}: futures pozitsiya o'lchami yetarli emas (marja: $${availableMargin.toFixed(2)})`);
      return;
    }

    const filters = await futuresGetFilters(signal.symbol);
    const quantity = floorToStep(positionUsd / currentPrice, filters.stepSize);
    if (quantity <= 0 || quantity * currentPrice < filters.minNotional) {
      console.log(`[AI Engine] Hisob ${account.id}: futures miqdor minNotional'dan kichik`);
      return;
    }

    try {
      await futuresSetLeverage(creds, signal.symbol, env.futuresLeverage);
    } catch (err) {
      console.warn(`[AI Engine] Leverage o'rnatishda ogohlantirish:`, err instanceof Error ? err.message : err);
    }

    const order = await futuresOpenPosition(creds, signal.symbol, signal.direction as "BUY" | "SELL", quantity);
    const fillPrice = order.avgPrice ?? currentPrice;
    const executedQty = order.executedQty > 0 ? order.executedQty : quantity;

    // Himoya: TP/SL birja tomonida. Joylashmasa — pozitsiya darhol yopiladi.
    let protectionId: string;
    try {
      const protection = await futuresPlaceProtection(
        creds,
        signal.symbol,
        signal.direction as "BUY" | "SELL",
        floorToStep(signal.takeProfit, filters.tickSize),
        floorToStep(signal.stopLoss, filters.tickSize)
      );
      protectionId = `F:${protection.tpOrderId}:${protection.slOrderId}`;
    } catch (err) {
      console.error(`[AI Engine] KRITIK: futures himoya joylashmadi — pozitsiya darhol yopiladi:`, err instanceof Error ? err.message : err);
      try {
        await futuresClosePosition(creds, signal.symbol, signal.direction as "BUY" | "SELL", executedQty);
        await notifyUser(
          account.userId,
          "Futures pozitsiyasi bekor qilindi",
          `${signal.symbol} pozitsiyasi ochildi, ammo TP/SL himoyasi o'rnatilmadi — xavfsizlik uchun pozitsiya darhol yopildi. Mablag'ingiz himoyasiz qolmadi.`
        );
      } catch (closeErr) {
        console.error(`[AI Engine] KRITIK: himoyasiz pozitsiyani yopib bo'lmadi:`, closeErr instanceof Error ? closeErr.message : closeErr);
        await notifyUser(
          account.userId,
          "DIQQAT: himoyasiz futures pozitsiyasi",
          `${signal.symbol} pozitsiyasi ochildi, ammo TP/SL o'rnatilmadi va avtomatik yopish ham muvaffaqiyatsiz. Binance'ga kirib pozitsiyani qo'lda tekshiring!`
        );
      }
      return;
    }

    const modeLabel = exchangeMode() === "live" ? "REAL" : "TESTNET (sinov)";
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
        marketType: "FUTURES",
        externalOrderId: order.orderId,
        ocoOrderListId: protectionId,
        stopLossPrice: signal.stopLoss,
        takeProfitPrice: signal.takeProfit,
      },
    });

    await syncFuturesAccountBalance(account.id, creds);

    await notifyUser(
      account.userId,
      `AI futures pozitsiyasi ochdi: ${signal.direction === "BUY" ? "LONG" : "SHORT"}`,
      `${signal.symbol} ${modeLabel} futures: ${executedQty} dona, ~$${fillPrice} narxda, ${env.futuresLeverage}x leverage (ishonch: ${signal.confidence}%). TP/SL birja tomonida o'rnatildi.`
    );
  } catch (err) {
    console.error(`[AI Engine] Futures ochish xatosi (account ${account.id}):`, err instanceof Error ? err.message : err);
    await notifyUser(
      account.userId,
      "AI futures buyurtmasi bajarilmadi",
      `${signal.symbol} bo'yicha futures buyurtma bajarilmadi. API kalitda futures ruxsati borligini va balansni tekshiring.`
    );
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
let fastGuardHandle: NodeJS.Timeout | null = null;
let reportHandle: NodeJS.Timeout | null = null;
let fastGuardRunning = false;

/* ─── Watchdog: ketma-ket sikl xatolarida Telegram ogohlantirishi ──────────── */

let consecutiveCycleFailures = 0;
let lastFailureAlertAt = 0;

async function guardedCycle() {
  try {
    await runAiCycle();
    consecutiveCycleFailures = 0;
  } catch (err) {
    consecutiveCycleFailures++;
    console.error("AI cycle error:", err);
    // 3+ ketma-ket xato = tizimli muammo (tarmoq, DB, birja) — egasiga xabar.
    // Soatiga bir martadan ko'p bezovta qilmaymiz.
    if (consecutiveCycleFailures >= 3 && Date.now() - lastFailureAlertAt > 60 * 60 * 1000) {
      lastFailureAlertAt = Date.now();
      void sendTelegram(
        `⚠️ <b>AI dvigatel muammosi</b>\n` +
        `${consecutiveCycleFailures} ta ketma-ket sikl xato bilan tugadi.\n` +
        `Oxirgi xato: ${err instanceof Error ? err.message : String(err)}\n` +
        `Ochiq pozitsiyalar birja tomonidagi TP/SL bilan himoyalangan. ` +
        `Loglarni tekshiring: pm2 logs adm-backend`
      );
    }
  }
}

/* ─── Kunlik Telegram hisoboti (har kuni soat 09:00 da) ────────────────────── */

const DAILY_REPORT_HOUR = 9;

async function maybeSendDailyReport() {
  try {
    const now = new Date();
    if (now.getHours() !== DAILY_REPORT_HOUR) return;

    const today = now.toISOString().slice(0, 10);
    if ((await getSetting("lastDailyReport")) === today) return;
    await setSetting("lastDailyReport", today);

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [openTrades, closedLastDay, accounts, paused] = await Promise.all([
      prisma.trade.findMany({ where: { status: "OPEN" }, select: { symbol: true, direction: true, entryPrice: true } }),
      prisma.trade.findMany({
        where: { status: "CLOSED", closedAt: { gte: dayAgo } },
        select: { pnlUsd: true },
      }),
      prisma.brokerAccount.findMany({ where: { isConnected: true }, select: { balanceUsd: true } }),
      isAiEnginePaused(),
    ]);

    const dayPnl = closedLastDay.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const dayWins = closedLastDay.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    const totalBalance = accounts.reduce((s, a) => s + a.balanceUsd, 0);

    const openList = openTrades.length > 0
      ? openTrades.map((tr) => `  • ${tr.symbol} ${tr.direction === "BUY" ? "LONG" : "SHORT"} @ ${tr.entryPrice}`).join("\n")
      : "  yo'q";

    await sendTelegram(
      `📊 <b>ADM Trading — kunlik hisobot</b>\n` +
      `Rejim: ${exchangeMode().toUpperCase()}${paused ? " · ⏸ TO'XTATILGAN" : " · ▶ ishlamoqda"}\n` +
      `Balans: $${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
      `Oxirgi 24 soat: ${closedLastDay.length} savdo yopildi (${dayWins} foydali), natija: ${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(2)}$\n` +
      `Ochiq pozitsiyalar (${openTrades.length}):\n${openList}`
    );
  } catch (err) {
    console.error("[AI Engine] Kunlik hisobot xatosi:", err instanceof Error ? err.message : err);
  }
}

/**
 * Tezkor himoya sikli (10s): WebSocket keshdagi real-vaqt narxlar bilan
 * himoyasiz (birja OCO/TP-SL'siz) pozitsiyalarni tekshiradi va break-even/
 * trailing'ni tezroq qo'llaydi. REST so'rov ishlatmaydi — rate-limit xavfsiz.
 */
async function runFastGuard() {
  if (fastGuardRunning) return;
  fastGuardRunning = true;
  try {
    await manageOpenTrades({ cacheOnly: true });
  } catch (err) {
    console.error("[AI Engine] Fast guard xatosi:", err instanceof Error ? err.message : err);
  } finally {
    fastGuardRunning = false;
  }
}

export function startAiEngine(intervalMs = 60_000) {
  if (intervalHandle) return;
  console.log(`AI Engine ishga tushdi (har ${intervalMs / 1000}s da bozorni tahlil qiladi, birja rejimi: ${exchangeMode().toUpperCase()})`);

  // Real-vaqt narx oqimi (WebSocket) — TP/SL aniqligi uchun
  startPriceFeed(SYMBOLS);

  void guardedCycle();
  intervalHandle = setInterval(() => {
    void guardedCycle();
  }, intervalMs);

  fastGuardHandle = setInterval(() => {
    void runFastGuard();
  }, 10_000);

  // Kunlik hisobot tekshiruvi har 5 daqiqada (soat 09:00 da bir marta yuboradi)
  reportHandle = setInterval(() => {
    void maybeSendDailyReport();
  }, 5 * 60 * 1000);
}

export function stopAiEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (fastGuardHandle) {
    clearInterval(fastGuardHandle);
    fastGuardHandle = null;
  }
  if (reportHandle) {
    clearInterval(reportHandle);
    reportHandle = null;
  }
  stopPriceFeed();
}
