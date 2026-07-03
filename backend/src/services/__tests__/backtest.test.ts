import { describe, expect, it } from "vitest";
import { runBacktest } from "../backtest";
import { analyzeCandles, Candle } from "../technicalAnalysis";

/** Deterministik psevdo-tasodifiy generator (test har doim bir xil natija beradi) */
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function makeCandles(count: number, startPrice: number, driftFn: (i: number) => number, seed = 42): Candle[] {
  const rng = makeRng(seed);
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const drift = driftFn(i);
    const noise = (rng() - 0.5) * 0.01;
    const open = price;
    const close = price * (1 + drift + noise);
    const high = Math.max(open, close) * (1 + rng() * 0.005);
    const low = Math.min(open, close) * (1 - rng() * 0.005);
    candles.push({ time: 1_700_000_000_000 + i * 3_600_000, open, high, low, close, volume: 100 + rng() * 50 });
    price = close;
  }
  return candles;
}

describe("analyzeCandles", () => {
  it("tekis (o'zgarishsiz) bozorda signal bermaydi", () => {
    const flat: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      time: i, open: 100, high: 100, low: 100, close: 100, volume: 10,
    }));
    expect(analyzeCandles(flat)).toBeNull();
  });

  it("60 tadan kam shamda null qaytaradi", () => {
    const few = makeCandles(30, 100, () => 0);
    expect(analyzeCandles(few)).toBeNull();
  });

  it("kuchli tushish trendida signal bersa, TP/SL to'g'ri joylashgan bo'ladi", () => {
    // 1% dan tushib boruvchi bozor — RSI oversold zonaga tushadi
    const candles = makeCandles(150, 100, () => -0.01);
    const signal = analyzeCandles(candles);
    if (signal) {
      const entry = signal.entryPrice;
      if (signal.direction === "BUY") {
        expect(signal.takeProfit).toBeGreaterThan(entry);
        expect(signal.stopLoss).toBeLessThan(entry);
      } else {
        expect(signal.takeProfit).toBeLessThan(entry);
        expect(signal.stopLoss).toBeGreaterThan(entry);
      }
      expect(signal.confidence).toBeGreaterThanOrEqual(55);
      expect(signal.confidence).toBeLessThanOrEqual(95);
    }
  });
});

describe("runBacktest", () => {
  // Trendlar almashinuvchi sun'iy bozor — signallar chiqishi uchun
  const candles = makeCandles(800, 100, (i) => {
    const phase = Math.floor(i / 100) % 4;
    return phase === 0 ? -0.008 : phase === 1 ? 0.006 : phase === 2 ? -0.004 : 0.008;
  });

  const result = runBacktest("TEST/USDT", "1h", candles);

  it("statistika ichki jihatdan izchil", () => {
    expect(result.wins + result.losses).toBeLessThanOrEqual(result.totalTrades);
    expect(result.expired).toBeLessThanOrEqual(result.totalTrades);
    expect(result.trades.length).toBeLessThanOrEqual(50);
    expect(result.equityCurve.length).toBeLessThanOrEqual(200);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.totalReturnPct)).toBe(true);
    if (result.totalTrades > 0) {
      expect(result.winRatePct).toBeGreaterThanOrEqual(0);
      expect(result.winRatePct).toBeLessThanOrEqual(100);
    }
  });

  it("har bir savdoda komissiya hisobga olingan (gross emas, net)", () => {
    for (const t of result.trades) {
      // TP bilan yopilgan BUY savdosi: net PnL gross'dan kichik bo'lishi shart
      const gross = t.direction === "BUY"
        ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100
        : ((t.entryPrice - t.exitPrice) / t.entryPrice) * 100;
      expect(t.pnlPct).toBeLessThan(gross + 1e-9);
    }
  });

  it("savdolar vaqt bo'yicha ustma-ust tushmaydi (bir vaqtda bitta pozitsiya)", () => {
    const all = result.trades;
    for (let i = 1; i < all.length; i++) {
      expect(all[i].entryTime).toBeGreaterThanOrEqual(all[i - 1].exitTime);
    }
  });

  it("deterministik — bir xil kirishda bir xil natija", () => {
    const again = runBacktest("TEST/USDT", "1h", candles);
    expect(again.totalTrades).toBe(result.totalTrades);
    expect(again.totalReturnPct).toBe(result.totalReturnPct);
  });
});
