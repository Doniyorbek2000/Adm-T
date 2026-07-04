import { prisma } from "../utils/prisma";

/**
 * Risk-menejment moduli — har bir avtomatik savdodan oldin tekshiriladi.
 *
 * Asosiy tamoyil: pozitsiya o'lchami "balansning ulushi" emas, balki
 * "SL gacha masofaga asoslangan risk" bilan hisoblanadi:
 *
 *   pozitsiya (USD) = (balans × savdo_boshiga_risk_%) / SL_masofa_%
 *
 * Ya'ni SL ishlasa, yo'qotish har doim balansning belgilangan kichik
 * foizidan oshmaydi — SL qanchalik uzoq bo'lsa, pozitsiya shunchalik kichik.
 *
 * Qo'shimcha himoyalar:
 *  - Bir hisobda maksimal ochiq pozitsiyalar soni
 *  - Kunlik zarar limiti (bugungi realized PnL limitdan oshsa — yangi savdo yo'q)
 *  - Bitta simvol bo'yicha bir vaqtda faqat bitta ochiq pozitsiya
 *  - Pozitsiya balansning belgilangan maksimal ulushidan oshmaydi
 */

export interface RiskProfile {
  /** Bitta savdoda tavakkal qilinadigan kapital ulushi (SL ishlaganda yo'qotish) */
  riskPerTradeFraction: number;
  /** Bir hisobdagi maksimal ochiq pozitsiyalar soni */
  maxOpenPositions: number;
  /** Kunlik maksimal zarar (balans ulushida) — oshsa, kun oxirigacha yangi savdo ochilmaydi */
  dailyLossLimitFraction: number;
  /** Yangi signalni bajarish uchun minimal ishonch darajasi */
  minConfidence: number;
}

/** riskLevel (1 - past, 2 - o'rta, 3 - yuqori) bo'yicha profillar */
export const RISK_PROFILES: Record<number, RiskProfile> = {
  1: { riskPerTradeFraction: 0.005, maxOpenPositions: 2, dailyLossLimitFraction: 0.03, minConfidence: 80 },
  2: { riskPerTradeFraction: 0.01,  maxOpenPositions: 3, dailyLossLimitFraction: 0.05, minConfidence: 70 },
  3: { riskPerTradeFraction: 0.02,  maxOpenPositions: 5, dailyLossLimitFraction: 0.08, minConfidence: 60 },
};

export function getRiskProfile(riskLevel: number): RiskProfile {
  return RISK_PROFILES[riskLevel] ?? RISK_PROFILES[2];
}

/** Pozitsiya hech qachon balansning shu ulushidan oshmaydi (konsentratsiya himoyasi) */
export const MAX_POSITION_FRACTION = 0.25;

/** Birja minimal buyurtma talablari uchun pastki chegara */
export const MIN_POSITION_USD = 10;

export interface PositionSizeInput {
  balanceUsd: number;
  /** Ochiq pozitsiyalarga band qilinmagan erkin kapital */
  availableUsd: number;
  entryPrice: number;
  stopLoss: number;
  riskPerTradeFraction: number;
}

/**
 * SL masofasiga asoslangan pozitsiya o'lchami (USD).
 * 0 qaytarsa — savdo ochilmasligi kerak (juda kichik yoki noto'g'ri kirish).
 */
export function computePositionSizeUsd(input: PositionSizeInput): number {
  const { balanceUsd, availableUsd, entryPrice, stopLoss, riskPerTradeFraction } = input;

  if (!(balanceUsd > 0) || !(availableUsd > 0) || !(entryPrice > 0)) return 0;

  const slDistanceFraction = Math.abs(entryPrice - stopLoss) / entryPrice;
  // SL kirish narxiga juda yaqin (< 0.1%) bo'lsa — pozitsiya portlab ketadi, rad etamiz
  if (!(slDistanceFraction >= 0.001)) return 0;

  const riskUsd = balanceUsd * riskPerTradeFraction;
  let positionUsd = riskUsd / slDistanceFraction;

  positionUsd = Math.min(positionUsd, balanceUsd * MAX_POSITION_FRACTION, availableUsd);

  if (positionUsd < MIN_POSITION_USD) return 0;
  return Number(positionUsd.toFixed(2));
}

export interface TradeGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Savdo ochishdan oldingi DB tekshiruvlari: ochiq pozitsiyalar soni,
 * shu simvolda takroriy pozitsiya, kunlik zarar limiti.
 */
export async function checkTradeAllowed(params: {
  accountId: string;
  symbol: string;
  balanceUsd: number;
  riskLevel: number;
}): Promise<TradeGateResult> {
  const profile = getRiskProfile(params.riskLevel);

  const openTrades = await prisma.trade.findMany({
    where: { brokerAccountId: params.accountId, status: "OPEN" },
    select: { symbol: true },
  });

  if (openTrades.length >= profile.maxOpenPositions) {
    return { allowed: false, reason: `Maksimal ochiq pozitsiyalar soniga yetildi (${profile.maxOpenPositions})` };
  }

  if (openTrades.some((t) => t.symbol === params.symbol)) {
    return { allowed: false, reason: `${params.symbol} bo'yicha allaqachon ochiq pozitsiya bor` };
  }

  // Bugungi realized zarar (UTC kun boshidan)
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayPnl = await prisma.trade.aggregate({
    where: { brokerAccountId: params.accountId, status: "CLOSED", closedAt: { gte: dayStart } },
    _sum: { pnlUsd: true },
  });
  const realizedToday = todayPnl._sum.pnlUsd ?? 0;
  const dailyLossLimitUsd = params.balanceUsd * profile.dailyLossLimitFraction;

  if (realizedToday < 0 && Math.abs(realizedToday) >= dailyLossLimitUsd) {
    return {
      allowed: false,
      reason: `Kunlik zarar limiti (${(profile.dailyLossLimitFraction * 100).toFixed(0)}%) oshdi — bugun yangi savdo ochilmaydi`,
    };
  }

  return { allowed: true };
}

/**
 * Signal yaratilgandan keyin narx qanchalik "qochib ketganini" tekshiradi.
 * Kirish endi foydasiz bo'lsa (SL tomonga yarim yo'l bosilgan yoki TP tomonga
 * 30% dan ortiq ketilgan) — savdo OCHILMAYDI, eskirgan signalga kirish
 * matematik jihatdan yutqazuvchi o'yin.
 */
export function isEntryStillValid(
  direction: "BUY" | "SELL",
  entryPrice: number,
  takeProfit: number,
  stopLoss: number,
  currentPrice: number
): boolean {
  if (!(entryPrice > 0) || !(currentPrice > 0)) return false;

  if (direction === "BUY") {
    const slDist = entryPrice - stopLoss;
    const tpDist = takeProfit - entryPrice;
    if (slDist <= 0 || tpDist <= 0) return false;
    if (currentPrice <= entryPrice - 0.5 * slDist) return false; // SL tomonga yarim yo'l
    if (currentPrice >= entryPrice + 0.3 * tpDist) return false; // TP tomonga 30%+ ketgan
    return true;
  }

  const slDist = stopLoss - entryPrice;
  const tpDist = entryPrice - takeProfit;
  if (slDist <= 0 || tpDist <= 0) return false;
  if (currentPrice >= entryPrice + 0.5 * slDist) return false;
  if (currentPrice <= entryPrice - 0.3 * tpDist) return false;
  return true;
}

export interface TrailAdvice {
  newStopLoss: number;
  reason: "BREAK_EVEN" | "TRAIL";
}

/** Trailing yangilanishi uchun minimal yaxshilanish (R birligida) — birjaga ortiqcha so'rov yubormaslik uchun */
const TRAIL_MIN_IMPROVEMENT_R = 0.5;

/**
 * Break-even va trailing stop mantiqi (sof funksiya):
 *  - Narx 1R foydaga yetganda SL zararsiz nuqtaga (entry ± komissiya buferi)
 *    ko'chiriladi — savdo endi yutqaza olmaydi.
 *  - Undan keyin SL narxdan 1R orqada ergashadi, faqat 0.5R dan ortiq
 *    yaxshilanish bo'lsa yangilanadi (birja API churn'ini oldini olish).
 * null — hozircha hech narsa o'zgartirilmasin.
 */
export function computeTrailedStop(params: {
  direction: "BUY" | "SELL";
  entryPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  currentPrice: number;
  breakEvenApplied: boolean;
}): TrailAdvice | null {
  const { direction, entryPrice, initialStopLoss, currentStopLoss, currentPrice, breakEvenApplied } = params;

  if (direction === "BUY") {
    const r = entryPrice - initialStopLoss;
    if (r <= 0) return null;

    if (!breakEvenApplied) {
      if (currentPrice >= entryPrice + r) {
        return { newStopLoss: Number((entryPrice * 1.002).toFixed(8)), reason: "BREAK_EVEN" };
      }
      return null;
    }

    const candidate = currentPrice - r;
    if (candidate >= currentStopLoss + TRAIL_MIN_IMPROVEMENT_R * r) {
      return { newStopLoss: Number(candidate.toFixed(8)), reason: "TRAIL" };
    }
    return null;
  }

  // SELL (short): hammasi teskari
  const r = initialStopLoss - entryPrice;
  if (r <= 0) return null;

  if (!breakEvenApplied) {
    if (currentPrice <= entryPrice - r) {
      return { newStopLoss: Number((entryPrice * 0.998).toFixed(8)), reason: "BREAK_EVEN" };
    }
    return null;
  }

  const candidate = currentPrice + r;
  if (candidate <= currentStopLoss - TRAIL_MIN_IMPROVEMENT_R * r) {
    return { newStopLoss: Number(candidate.toFixed(8)), reason: "TRAIL" };
  }
  return null;
}

/** Hisobning ochiq pozitsiyalarga band qilingan kapitali (USD) */
export async function deployedCapitalUsd(accountId: string): Promise<number> {
  const openTrades = await prisma.trade.findMany({
    where: { brokerAccountId: accountId, status: "OPEN" },
    select: { entryPrice: true, quantity: true },
  });
  return openTrades.reduce((sum, t) => sum + t.entryPrice * t.quantity, 0);
}
