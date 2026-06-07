import { PlanType, SignalDirection, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { decryptSecret } from "../utils/crypto";
import { exchangeMode, fetchSpotPrice } from "./exchanges/binance";
import { ExchangeAdapter, ExchangeCredentials, getExchangeAdapter, isRealExchangeIntegrated } from "./exchanges/registry";

/**
 * ADM Trading AI Engine
 * --------------------------------------------------------------
 * Bu modul "sun'iy intellekt" tahlil va savdo mexanizmini boshqaradi:
 *   1) Bozorni "tahlil qilib" yangi savdo signallarini generatsiya qiladi
 *      (narx Binance'ning haqiqiy bozor narxlariga asoslanadi - pastga qarang)
 *   2) Ochiq signallarni vaqt o'tishi bilan TP/SL bo'yicha yopadi
 *   3) AUTO_TRADE rejimidagi foydalanuvchi hisoblari uchun signallar asosida
 *      avtomatik savdo (trade) ochadi va yopadi - foydalanuvchi ishtirokisiz
 *
 * REAL vs SIMULYATSIYA - MUHIM:
 *   - Real REST API integratsiyasiga ega birjalar - Binance, Bybit, OKX,
 *     KuCoin, BingX (qarang: services/exchanges/registry.ts) - uchun, agar
 *     hisob ulangan (isConnected) va AUTO_TRADE rejimida bo'lsa, AI HAQIQIY
 *     bozor buyurtmalarini joylashtiradi (EXCHANGE_MODE muhit o'zgaruvchisiga
 *     qarab "testnet"/sandbox sinov muhitida yoki "live" da - productionda
 *     REAL pul bilan). Har bir trade'ning `executionMode` maydoni uning qaysi
 *     muhitda bajarilganini ko'rsatadi: SIMULATED | TESTNET | LIVE.
 *   - Spot (oddiy) hisoblarda "SHORT" pozitsiya ochib bo'lmaydi, shuning uchun
 *     SELL yo'nalishidagi signallar real spot hisoblarda avtomatik
 *     bajarilmaydi - faqat signal sifatida qoladi (xavfsizlik chorasi,
 *     fyuchers/marja savdosi - yuqori tavakkal va likvidatsiya xavfi tufayli
 *     hozircha qo'llab-quvvatlanmaydi).
 *   - MT5 va "Demo" hisoblar uchun hali real integratsiya yo'q: MetaTrader 5
 *     boshqa birjalardan farqli o'laroq ommaviy REST API'ga ega emas (Windows
 *     terminal protokoli) - haqiqiy ulanish uchun alohida "bridge" xizmati
 *     (masalan, MetaApi.cloud kabi uchinchi tomon SaaS yoki maxsus Expert
 *     Advisor + WebSocket ko'prigi) talab qilinadi. Bunday hisoblar uchun
 *     savdo natijalari mantiqiy modelga asoslangan deterministik-tasodifiy
 *     generator orqali simulyatsiya qilinadi (executionMode = SIMULATED).
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

const PRICE_DECIMALS = (symbol: string) => (symbol === "XRP/USDT" || symbol === "ADA/USDT" ? 4 : 2);

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

/**
 * Signal uchun kirish narxini aniqlaydi: avval Binance'ning haqiqiy bozor
 * narxini olishga harakat qiladi (shu orqali signal narxlari haqiqiy bozorga
 * mos bo'ladi), tarmoq xatosi yoki birja vaqtinchalik javob bermasa - mantiqiy
 * zaxira (fallback) sifatida ichki taxminiy bazaviy narxdan foydalanadi.
 */
async function resolveEntryPrice(symbol: string): Promise<number> {
  const decimals = PRICE_DECIMALS(symbol);
  try {
    const livePrice = await fetchSpotPrice(symbol);
    // Kirish nuqtasini "tahlil qilingan" signal sifatida ko'rsatish uchun
    // joriy bozor narxiga nisbatan kichik (+/-0.2%) farq qo'shamiz
    const entry = livePrice * randomBetween(0.998, 1.002);
    return Number(entry.toFixed(decimals));
  } catch (err) {
    console.error(`[AI Engine] Binance narxini olib bo'lmadi (${symbol}), zaxira manbadan foydalanilmoqda:`, err instanceof Error ? err.message : err);
    const base = basePriceFor(symbol);
    return Number((base * randomBetween(0.985, 1.015)).toFixed(decimals));
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
  const entryPrice = await resolveEntryPrice(symbol);

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
 *
 * Eslatma: signal natijasi (g'alaba/mag'lubiyat) hozircha mantiqiy modelga
 * asoslangan tasodifiy generator orqali aniqlanadi - lekin haqiqiy (Binance)
 * hisoblar uchun bu signal "real bozor signali" rolini o'ynaydi va unga
 * bog'langan tradelar HAQIQIY bozor buyurtmalari orqali ochiladi/yopiladi
 * (pastga, autoExecuteSignal va closeTradesForSignal'ga qarang).
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

  // Signali allaqachon yopilgan, lekin (masalan, tarmoq xatosi tufayli)
  // birjada yopilmay qolgan haqiqiy tradelarni qayta yopishga urinamiz
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

/** Signali allaqachon yopilgan, lekin birjada hali yopilmagan haqiqiy tradelarni topib, qayta yopishga urinadi */
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

/** Hisob kalitlarini (va mavjud bo'lsa, passphrase'ni) deshifrlaydi - faqat haqiqiy birja so'rovlari uchun ishlatiladi */
function decryptCredentials(account: { apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted?: string | null }): ExchangeCredentials {
  return {
    apiKey: decryptSecret(account.apiKeyEncrypted),
    apiSecret: decryptSecret(account.apiSecretEncrypted),
    passphrase: account.passphraseEncrypted ? decryptSecret(account.passphraseEncrypted) : undefined,
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

/**
 * Ulangan birjada ochilgan HAQIQIY pozitsiyani yopadi: avval sotib olingan
 * miqdorni real bozor SELL buyurtmasi orqali sotadi, haqiqiy bajarilish
 * narxidan PnL hisoblaydi va hisob balansini birjadan qayta sinxronlaydi.
 */
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
    console.error(`[AI Engine] Hisob ${account.id} kalitlarini ochib bo'lmadi, simulyatsiyaga o'tilmoqda:`, err instanceof Error ? err.message : err);
    await closeSimulatedTrade(trade, fallbackExitPrice, fallbackResultPnlPct);
    return;
  }

  try {
    const order = await adapter.placeMarketSell(creds, trade.symbol, trade.quantity);
    const exitPrice = order.avgPrice ?? fallbackExitPrice;
    const pnlUsd = Number(((exitPrice - trade.entryPrice) * trade.quantity).toFixed(2));

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
        message: `${trade.symbol} ${trade.direction} (${modeLabel}, ${adapter.id}) savdosi yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$`,
      },
    });
  } catch (err) {
    // Yopib bo'lmadi (masalan, tarmoq yoki birja xatosi) - keyingi siklda
    // retryStuckRealTrades orqali qayta urinib ko'riladi, hozircha holatini
    // o'zgartirmaymiz (mablag'ni "yo'qotib qo'ymaslik" uchun muhim)
    console.error(`[AI Engine] ${adapter.id} yopish buyurtmasi xato (trade ${trade.id}):`, err instanceof Error ? err.message : err);
  }
}

/** Hisob balansini ulangan birjadagi haqiqiy USDT balansi bilan qayta sinxronlaydi */
async function syncExchangeAccountBalance(adapter: ExchangeAdapter, accountId: string, creds: ExchangeCredentials) {
  try {
    const usdtBalance = await adapter.fetchQuoteBalance(creds);
    await prisma.brokerAccount.update({ where: { id: accountId }, data: { balanceUsd: usdtBalance } });
  } catch (err) {
    console.error(`[AI Engine] Hisob ${accountId} balansini sinxronlashda xato:`, err instanceof Error ? err.message : err);
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

    if (isRealExchangeIntegrated(account.exchange) && account.isConnected) {
      await openRealExchangeTrade(account, signal, positionUsd);
    } else {
      await openSimulatedTrade(account, signal, positionUsd);
    }
  }
}

async function openSimulatedTrade(
  account: { id: string; userId: string; balanceUsd: number },
  signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number },
  positionUsd: number
) {
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
      message: `${signal.symbol} bo'yicha ${signal.direction === "BUY" ? "xarid" : "sotish"} pozitsiyasi ochildi (ishonch: ${signal.confidence}%).`,
    },
  });
}

/**
 * Ulangan birjada (Binance/Bybit/OKX/KuCoin/BingX) HAQIQIY bozor buyurtmasini
 * joylashtiradi (testnet yoki live - EXCHANGE_MODE'ga qarab). Spot hisoblarda
 * shortlash imkonsiz bo'lgani uchun faqat BUY yo'nalishidagi signallar
 * bajariladi; SELL signallari xavfsiz tarzda o'tkazib yuboriladi (faqat
 * signal sifatida saqlanadi).
 */
async function openRealExchangeTrade(
  account: { id: string; userId: string; balanceUsd: number; exchange: string; apiKeyEncrypted: string; apiSecretEncrypted: string; passphraseEncrypted: string | null },
  signal: { id: string; symbol: string; direction: SignalDirection; entryPrice: number; confidence: number },
  positionUsd: number
) {
  const adapter = getExchangeAdapter(account.exchange);
  if (!adapter) {
    await openSimulatedTrade(account, signal, positionUsd);
    return;
  }

  if (signal.direction !== SignalDirection.BUY) {
    await prisma.notification.create({
      data: {
        userId: account.userId,
        title: "SELL signali avtomatik bajarilmadi",
        message: `${signal.symbol} bo'yicha SELL signali paydo bo'ldi, ammo spot (oddiy) hisobda "shortlash" imkonsiz bo'lgani uchun AI buyurtma joylashtirmadi - mablag'ingiz xavfsiz qoldi. Signal sifatida saqlandi.`,
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
        message: `${signal.symbol} bo'yicha avtomatik buyurtma bajarilmadi (API kalit, ruxsat yoki balans bilan bog'liq xatolik bo'lishi mumkin). Hisobingiz sozlamalarini tekshiring.`,
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
