import { env } from "../utils/env";
import { fetchCandles } from "./technicalAnalysis";

/**
 * Bozor konteksti — texnik indikatorlardan TASHQARIDAGI signallar.
 * Hammasi BEPUL manbalardan, qo'shimcha API kalit talab qilmaydi:
 *
 *  1. Fear & Greed Index (alternative.me) — bozor kayfiyati 0-100.
 *     Ekstremal ochko'zlikda (>=80) yangi BUY'lar xavfli (cho'qqi yaqin),
 *     ekstremal qo'rquvda (<=20) yangi SELL'lar xavfli (tub yaqin).
 *
 *  2. BTC 1 soatlik momentum — kripto bozori BTC ortidan yuradi. BTC keskin
 *     tushayotganda (masalan -2%/soat) altcoin BUY signali ochish —
 *     "pichoq ushlash"; keskin o'sishda altcoin SHORT ochish ham xavfli.
 *
 *  3. Funding rate (Binance futures, ommaviy endpoint) — juda yuqori musbat
 *     funding = olomon longda (crowded long), qisqa squeeze xavfi; juda
 *     manfiy = olomon shortda. Ekstremal qiymat ishonchni pasaytiradi.
 *
 * Bu filtrlar signal SIFATINI oshiradi — savdo sonini kamaytirib, eng xavfli
 * kirishlarni bloklaydi. 100% aniqlik bermaydi (bunday narsa mavjud emas),
 * ammo kutilmani (expectancy) yaxshilaydi.
 */

export interface MarketContext {
  /** 0-100; null — olinmadi */
  fearGreed: number | null;
  /** BTC oxirgi yopilgan 1h shamning o'zgarishi, % */
  btcChange1hPct: number | null;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
let cached: { ctx: MarketContext; fetchedAt: number } | null = null;

export async function getMarketContext(): Promise<MarketContext> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.ctx;

  const [fearGreed, btcChange1hPct] = await Promise.all([fetchFearGreed(), fetchBtcMomentum()]);
  const ctx: MarketContext = { fearGreed, btcChange1hPct };
  cached = { ctx, fetchedAt: Date.now() };
  return ctx;
}

async function fetchFearGreed(): Promise<number | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const value = Number(data?.data?.[0]?.value);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  } catch {
    return null;
  }
}

async function fetchBtcMomentum(): Promise<number | null> {
  try {
    const candles = await fetchCandles("BTC/USDT", "1h", 3);
    if (candles.length < 2) return null;
    // Oxirgi YOPILGAN sham (oxirgisi hali ochiq bo'lishi mumkin)
    const closed = candles[candles.length - 2];
    const change = ((closed.close - closed.open) / closed.open) * 100;
    // Joriy (ochiq) sham harakati ham keskin bo'lsa, uni olamiz (yomonroq holat)
    const live = candles[candles.length - 1];
    const liveChange = ((live.close - live.open) / live.open) * 100;
    const worst = Math.abs(liveChange) > Math.abs(change) ? liveChange : change;
    return Number(worst.toFixed(2));
  } catch {
    return null;
  }
}

/** Binance futures funding rate (ommaviy, kalitsiz). null — olinmadi. */
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const fSymbol = symbol.replace("/", "").toUpperCase();
    const base = env.exchangeMode === "live" ? "https://fapi.binance.com" : "https://testnet.binancefuture.com";
    const res = await fetch(`${base}/fapi/v1/premiumIndex?symbol=${fSymbol}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const rate = Number(data?.lastFundingRate);
    return Number.isFinite(rate) ? rate : null;
  } catch {
    return null;
  }
}

/* ─── Sof qaror mantiqi (test qilinadi) ─────────────────────────────────────── */

export interface ContextDecision {
  allowed: boolean;
  /** O'zgartirilgan ishonch darajasi */
  confidence: number;
  /** Qo'llangan filtrlar tavsifi (signal tahliliga qo'shiladi) */
  notes: string[];
  /** Bloklangan bo'lsa — sabab */
  blockReason?: string;
}

/** BTC shu chegaradan keskinroq harakat qilsa, unga QARSHI alt-savdolar bloklanadi */
export const BTC_GUARD_THRESHOLD_PCT = 2.0;

/**
 * Bozor kontekstini signalga qo'llaydi (sof funksiya).
 *  - BTC keskin tushishida altcoin BUY bloklanadi (va aksincha)
 *  - Ekstremal Fear&Greed qarshi yo'nalishdagi ishonchni pasaytiradi
 *  - Ekstremal funding rate (|rate| >= 0.075%) ishonchni pasaytiradi
 */
export function applyContextToSignal(params: {
  direction: "BUY" | "SELL";
  confidence: number;
  symbol: string;
  ctx: MarketContext;
  fundingRate?: number | null;
}): ContextDecision {
  const { direction, symbol, ctx, fundingRate } = params;
  let confidence = params.confidence;
  const notes: string[] = [];
  const isBtc = symbol.startsWith("BTC/");

  // 1) BTC halokat himoyasi — altcoinlar BTC ortidan quladi/otiladi
  if (!isBtc && ctx.btcChange1hPct !== null) {
    if (direction === "BUY" && ctx.btcChange1hPct <= -BTC_GUARD_THRESHOLD_PCT) {
      return {
        allowed: false,
        confidence,
        notes,
        blockReason: `BTC 1 soatda ${ctx.btcChange1hPct}% tushmoqda — altcoin BUY bloklandi (bozor bo'ylab qulash xavfi)`,
      };
    }
    if (direction === "SELL" && ctx.btcChange1hPct >= BTC_GUARD_THRESHOLD_PCT) {
      return {
        allowed: false,
        confidence,
        notes,
        blockReason: `BTC 1 soatda +${ctx.btcChange1hPct}% o'smoqda — altcoin SELL bloklandi (short-squeeze xavfi)`,
      };
    }
  }

  // 2) Fear & Greed — ekstremal kayfiyatda ehtiyotkorlik
  if (ctx.fearGreed !== null) {
    if (direction === "BUY" && ctx.fearGreed >= 80) {
      confidence -= 5;
      notes.push(`Ekstremal ochko'zlik (F&G ${ctx.fearGreed}) — BUY ishonchi pasaytirildi`);
    } else if (direction === "SELL" && ctx.fearGreed <= 20) {
      confidence -= 5;
      notes.push(`Ekstremal qo'rquv (F&G ${ctx.fearGreed}) — SELL ishonchi pasaytirildi`);
    } else if (direction === "BUY" && ctx.fearGreed <= 20) {
      confidence += 3;
      notes.push(`Ekstremal qo'rquv (F&G ${ctx.fearGreed}) — kontrarian BUY uchun qulay zona`);
    } else if (direction === "SELL" && ctx.fearGreed >= 80) {
      confidence += 3;
      notes.push(`Ekstremal ochko'zlik (F&G ${ctx.fearGreed}) — kontrarian SELL uchun qulay zona`);
    }
  }

  // 3) Funding rate — olomon bir tomonda bo'lsa, o'sha tomonga qo'shilish xavfli
  if (fundingRate !== null && fundingRate !== undefined) {
    const ratePct = fundingRate * 100;
    if (direction === "BUY" && ratePct >= 0.075) {
      confidence -= 4;
      notes.push(`Funding ${ratePct.toFixed(3)}% — olomon longda, BUY ehtiyotkorlik`);
    } else if (direction === "SELL" && ratePct <= -0.075) {
      confidence -= 4;
      notes.push(`Funding ${ratePct.toFixed(3)}% — olomon shortda, SELL ehtiyotkorlik`);
    }
  }

  confidence = Math.min(97, Math.max(50, Math.round(confidence)));

  // Kontekst filtrlaridan keyin ishonch juda pasaysa — savdo arzimaydi
  if (confidence < 55) {
    return { allowed: false, confidence, notes, blockReason: "Bozor konteksti filtrlaridan keyin ishonch juda past" };
  }

  return { allowed: true, confidence, notes };
}
