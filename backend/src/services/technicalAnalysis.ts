/**
 * Haqiqiy Texnik Tahlil Mexanizmi
 * ─────────────────────────────────────────────────────────────────────────────
 * Bu modul Binance'ning OHLCV (sham) ma'lumotlaridan foydalanib
 * haqiqiy texnik indikatorlarni hisoblaydi va BUY/SELL signallarini chiqaradi.
 *
 * Ishlatilayotgan indikatorlar:
 *  • RSI (14)        — ortiqcha sotilgan/sotib olingan zonalar
 *  • MACD (12,26,9)  — trend o'zgarishi momenti
 *  • EMA(20), EMA(50) — qisqa/o'rta muddatli trendlar
 *  • Bollinger Bands (20,2) — volatillik va narx chegaralari
 *  • ATR (14)        — dinamik TP va SL uchun volatillik o'lchovi
 *  • Stochastic (14,3,3) — qo'shimcha overbought/oversold tasdiqlash
 *
 * Signal mantiq (confluence — bir nechta tasdiq kerak):
 *  BUY : RSI < 40, MACD histogram o'sishda, narx EMA(20) dan yuqori,
 *        yoki BB quyi chiziqdan sakrash, yoki Stoch oversold dan chiqish
 *  SELL: RSI > 60, MACD histogram tushishda, narx EMA(20) dan past,
 *        yoki BB yuqori chiziqqa tegish, yoki Stoch overbought dan tushish
 *
 * TP = kirish narxi + 2×ATR (BUY uchun)
 * SL = kirish narxi - 1×ATR (BUY uchun)   → Risk:Reward ≈ 1:2
 */

import { withRateLimit } from "./exchanges/rateLimiter";

const BINANCE_BASE = "https://api.binance.com";

// ─── OHLCV ma'lumotlarini Binance'dan olish ─────────────────────────────────

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchCandles(symbol: string, interval: "15m" | "1h" | "4h" = "1h", limit = 200): Promise<Candle[]> {
  return withRateLimit("binance:public", async () => {
    const binanceSymbol = symbol.replace("/", "");
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Klines so'rovi muvaffaqiyatsiz: HTTP ${res.status}`);
    const raw = (await res.json()) as any[][];
    return raw.map((k) => ({
      time:   Number(k[0]),
      open:   Number(k[1]),
      high:   Number(k[2]),
      low:    Number(k[3]),
      close:  Number(k[4]),
      volume: Number(k[5]),
    }));
  });
}

// ─── Indikator hisoblash yordamchi funksiyalari ──────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(...new Array(period - 1).fill(NaN));
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function atr(candles: Candle[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low  - candles[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  const result: number[] = new Array(period).fill(NaN);
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(avg);
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    result.push(avg);
  }
  return result; // length = candles.length - 1 (aligned from index 1)
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast   = ema(closes, fast);
  const emaSlow   = ema(closes, slow);
  const macdLine  = emaFast.map((f, i) => (isNaN(f) || isNaN(emaSlow[i])) ? NaN : f - emaSlow[i]);
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalEma = ema(validMacd, signal);
  // Pad signal to original length
  const padLen  = macdLine.length - validMacd.length;
  const signalLine: number[] = [...new Array(padLen).fill(NaN), ...signalEma];
  const histogram = macdLine.map((m, i) => (isNaN(m) || isNaN(signalLine[i])) ? NaN : m - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function bollinger(closes: number[], period = 20, mult = 2) {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); middle.push(NaN); lower.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + mult * std);
    middle.push(mean);
    lower.push(mean - mult * std);
  }
  return { upper, middle, lower };
}

function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  const kValues: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) { kValues.push(NaN); continue; }
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const low  = Math.min(...slice.map((c) => c.low));
    const high = Math.max(...slice.map((c) => c.high));
    kValues.push(high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100);
  }
  const dValues = ema(kValues.filter((v) => !isNaN(v)), dPeriod);
  const padLen  = kValues.length - dValues.length;
  return {
    k: kValues,
    d: [...new Array(padLen).fill(NaN), ...dValues],
  };
}

// ─── Asosiy tahlil funksiyasi ────────────────────────────────────────────────

export interface TaSignal {
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;      // 50-97 oralig'ida
  entryPrice: number;
  takeProfit: number;
  stopLoss:   number;
  analysis:   string;
  indicators: {
    rsi: number;
    macdHist: number;
    ema20: number;
    ema50: number;
    bbPercent: number; // narxning BB ichidagi holati 0-100%
    stochK: number;
    atr: number;
  };
}

export async function analyzeSymbol(symbol: string, interval: "15m" | "1h" | "4h" = "1h"): Promise<TaSignal | null> {
  let candles: Candle[];
  try {
    candles = await fetchCandles(symbol, interval, 200);
  } catch (err) {
    console.error(`[TA] ${symbol} shamlarini yuklashda xato:`, err instanceof Error ? err.message : err);
    return null;
  }
  if (candles.length < 60) return null;

  const closes  = candles.map((c) => c.close);
  const current = closes[closes.length - 1];

  // Indikatorlar
  const rsiVals    = rsi(closes);
  const macdResult = macd(closes);
  const ema20Vals  = ema(closes, 20);
  const ema50Vals  = ema(closes, 50);
  const bbResult   = bollinger(closes, 20, 2);
  const atrVals    = atr(candles);
  const stochVals  = stochastic(candles);

  // Oxirgi qiymatlar
  const lastRsi   = rsiVals[rsiVals.length - 1];
  const prevRsi   = rsiVals[rsiVals.length - 2];
  const lastHist  = macdResult.histogram[macdResult.histogram.length - 1];
  const prevHist  = macdResult.histogram[macdResult.histogram.length - 2];
  const lastEma20 = ema20Vals[ema20Vals.length - 1];
  const lastEma50 = ema50Vals[ema50Vals.length - 1];
  const lastBbU   = bbResult.upper[bbResult.upper.length - 1];
  const lastBbL   = bbResult.lower[bbResult.lower.length - 1];
  const lastBbM   = bbResult.middle[bbResult.middle.length - 1];
  const lastAtr   = atrVals[atrVals.length - 1];
  const lastStochK = stochVals.k[stochVals.k.length - 1];
  const prevStochK = stochVals.k[stochVals.k.length - 2];

  if (isNaN(lastRsi) || isNaN(lastHist) || isNaN(lastEma20) || isNaN(lastAtr)) return null;

  // BB foizi (narx BB ichida qayerda: 0=pastki, 100=yuqori)
  const bbRange   = lastBbU - lastBbL;
  const bbPercent = bbRange > 0 ? ((current - lastBbL) / bbRange) * 100 : 50;

  // ─── BUY shartlari ────────────────────────────────────────────────────────
  const buySignals: { desc: string; weight: number }[] = [];
  const sellSignals: { desc: string; weight: number }[] = [];

  // RSI
  if (lastRsi < 35)            buySignals.push({ desc: `RSI(${lastRsi.toFixed(1)}) ortiqcha sotilgan zonada`, weight: 3 });
  else if (lastRsi < 45 && prevRsi > lastRsi + 1) buySignals.push({ desc: `RSI(${lastRsi.toFixed(1)}) tushish kuchaymoqda`, weight: 1 });

  if (lastRsi > 65)            sellSignals.push({ desc: `RSI(${lastRsi.toFixed(1)}) ortiqcha sotib olingan`, weight: 3 });
  else if (lastRsi > 55 && prevRsi < lastRsi - 1) sellSignals.push({ desc: `RSI(${lastRsi.toFixed(1)}) o'sish kuchaymoqda`, weight: 1 });

  // MACD histogram
  if (lastHist > 0 && prevHist <= 0) buySignals.push({ desc: "MACD histogram musbat kesishdi", weight: 3 });
  else if (lastHist > 0 && lastHist > prevHist) buySignals.push({ desc: "MACD momentum o'sishda", weight: 1 });

  if (lastHist < 0 && prevHist >= 0) sellSignals.push({ desc: "MACD histogram manfiy kesishdi", weight: 3 });
  else if (lastHist < 0 && lastHist < prevHist) sellSignals.push({ desc: "MACD momentum tushishda", weight: 1 });

  // EMA trend
  if (current > lastEma20 && lastEma20 > lastEma50) buySignals.push({ desc: "Narx EMA(20/50) ustida — ko'tarilish trendi", weight: 2 });
  else if (current > lastEma20) buySignals.push({ desc: "Narx EMA(20) ustida", weight: 1 });

  if (current < lastEma20 && lastEma20 < lastEma50) sellSignals.push({ desc: "Narx EMA(20/50) ostida — tushish trendi", weight: 2 });
  else if (current < lastEma20) sellSignals.push({ desc: "Narx EMA(20) ostida", weight: 1 });

  // Bollinger Bands
  if (bbPercent < 10) buySignals.push({ desc: "Narx BB pastki chizig'iga taqaldi (oversold)", weight: 2 });
  if (bbPercent > 90) sellSignals.push({ desc: "Narx BB yuqori chizig'iga yetdi (overbought)", weight: 2 });

  // Stochastic
  if (lastStochK < 20 && prevStochK < lastStochK) buySignals.push({ desc: "Stochastic oversold zonadan chiqmoqda", weight: 2 });
  if (lastStochK > 80 && prevStochK > lastStochK) sellSignals.push({ desc: "Stochastic overbought zonadan tushmoqda", weight: 2 });

  // ─── Qaror ───────────────────────────────────────────────────────────────
  const buyScore  = buySignals.reduce((s, b) => s + b.weight, 0);
  const sellScore = sellSignals.reduce((s, b) => s + b.weight, 0);

  // Signal bo'lmasa — HOLD
  if (buyScore < 4 && sellScore < 4) return null;

  const direction: "BUY" | "SELL" = buyScore >= sellScore ? "BUY" : "SELL";
  const activeSignals = direction === "BUY" ? buySignals : sellSignals;
  const maxScore      = 12; // to'liq tasdiqlash uchun maksimal ball
  const scoreUsed     = direction === "BUY" ? buyScore : sellScore;

  // Ishonch darajasi (55-95% oralig'ida)
  const confidence = Math.min(95, Math.max(55, Math.round(55 + (scoreUsed / maxScore) * 40)));

  // ATR asosida dinamik TP/SL (Risk:Reward = 1:2)
  const atrMultTp = 2.0;
  const atrMultSl = 1.0;
  const tp = direction === "BUY"
    ? Number((current + atrMultTp * lastAtr).toFixed(8))
    : Number((current - atrMultTp * lastAtr).toFixed(8));
  const sl = direction === "BUY"
    ? Number((current - atrMultSl * lastAtr).toFixed(8))
    : Number((current + atrMultSl * lastAtr).toFixed(8));

  const topReasons = activeSignals
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((s) => s.desc)
    .join("; ");

  return {
    direction,
    confidence,
    entryPrice: current,
    takeProfit: tp,
    stopLoss:   sl,
    analysis:   topReasons,
    indicators: {
      rsi:      Number(lastRsi.toFixed(1)),
      macdHist: Number(lastHist.toFixed(6)),
      ema20:    Number(lastEma20.toFixed(2)),
      ema50:    Number(lastEma50.toFixed(2)),
      bbPercent: Number(bbPercent.toFixed(1)),
      stochK:   Number(lastStochK.toFixed(1)),
      atr:      Number(lastAtr.toFixed(6)),
    },
  };
}

/**
 * Barcha kuzatilayotgan juftliklar uchun tahlil o'tkazadi va
 * eng kuchli signalni qaytaradi (yoki null, agar signal bo'lmasa).
 */
export async function findBestSignal(symbols: string[]): Promise<{
  symbol: string;
  signal: TaSignal;
} | null> {
  const results = await Promise.allSettled(
    symbols.map(async (sym) => ({ symbol: sym, signal: await analyzeSymbol(sym) }))
  );

  const valid = results
    .filter((r): r is PromiseFulfilledResult<{ symbol: string; signal: TaSignal | null }> =>
      r.status === "fulfilled" && r.value.signal !== null
    )
    .map((r) => r.value as { symbol: string; signal: TaSignal });

  if (valid.length === 0) return null;

  // Eng yuqori ishonch darajasini qaytarish
  return valid.sort((a, b) => b.signal.confidence - a.signal.confidence)[0];
}
