import { describe, expect, it } from "vitest";
import { computeTrailedStop, isEntryStillValid } from "../riskManager";
import { adx, aggregateCandles, analyzeCandles, Candle, computeHtfContext } from "../technicalAnalysis";

function makeCandles(count: number, startPrice: number, driftFn: (i: number) => number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price * (1 + driftFn(i));
    candles.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 100,
    });
    price = close;
  }
  return candles;
}

describe("adx", () => {
  it("kuchli trendda yuqori, diapazon (range) bozorda past bo'ladi", () => {
    const trending = makeCandles(100, 100, () => 0.01); // doimiy 1% o'sish
    const ranging = makeCandles(100, 100, (i) => 0.012 * Math.sin(i / 3)); // to'lqinli diapazon

    const trendAdx = adx(trending);
    const rangeAdx = adx(ranging);
    const lastTrend = trendAdx[trendAdx.length - 1];
    const lastRange = rangeAdx[rangeAdx.length - 1];

    expect(lastTrend).toBeGreaterThan(25);
    expect(lastRange).toBeLessThan(25);
    expect(lastRange).toBeGreaterThanOrEqual(0);
  });

  it("ma'lumot yetarli bo'lmasa NaN qaytaradi", () => {
    const few = makeCandles(10, 100, () => 0.01);
    expect(adx(few).every((v) => isNaN(v))).toBe(true);
  });
});

describe("aggregateCandles", () => {
  it("4 ta 1h shamni bitta 4h shamga to'g'ri birlashtiradi", () => {
    const candles: Candle[] = [
      { time: 0, open: 100, high: 105, low: 99, close: 102, volume: 10 },
      { time: 1, open: 102, high: 110, low: 101, close: 108, volume: 20 },
      { time: 2, open: 108, high: 109, low: 95, close: 97, volume: 30 },
      { time: 3, open: 97, high: 103, low: 96, close: 101, volume: 40 },
    ];
    const [agg] = aggregateCandles(candles, 4);
    expect(agg.open).toBe(100);
    expect(agg.close).toBe(101);
    expect(agg.high).toBe(110);
    expect(agg.low).toBe(95);
    expect(agg.volume).toBe(100);
  });

  it("to'liq bo'lmagan oxirgi guruhni tashlab yuboradi", () => {
    const candles = makeCandles(10, 100, () => 0);
    expect(aggregateCandles(candles, 4)).toHaveLength(2);
  });
});

describe("computeHtfContext", () => {
  it("barqaror o'sishda BULL trend aniqlaydi", () => {
    const ctx = computeHtfContext(makeCandles(100, 100, () => 0.008));
    expect(ctx?.trend).toBe("BULL");
  });

  it("barqaror tushishda BEAR trend aniqlaydi", () => {
    const ctx = computeHtfContext(makeCandles(100, 100, () => -0.008));
    expect(ctx?.trend).toBe("BEAR");
  });

  it("60 tadan kam shamda null qaytaradi", () => {
    expect(computeHtfContext(makeCandles(30, 100, () => 0.01))).toBeNull();
  });
});

describe("analyzeCandles + HTF gating", () => {
  it("kuchli 4h BEAR trendda BUY signali bloklanadi", () => {
    // 1h da RSI oversold holat (BUY moyillik yaratadi)
    const ltf = makeCandles(150, 100, () => -0.01);
    const noHtf = analyzeCandles(ltf, null);
    const withBearHtf = analyzeCandles(ltf, { trend: "BEAR", adx: 40 });

    // HTF'siz BUY chiqsa, kuchli BEAR kontekstda chiqmasligi kerak
    if (noHtf?.direction === "BUY") {
      expect(withBearHtf === null || withBearHtf.direction !== "BUY").toBe(true);
    }
  });

  it("HTF NEUTRAL bo'lsa signal bloklanmaydi", () => {
    const ltf = makeCandles(150, 100, () => -0.01);
    const noHtf = analyzeCandles(ltf, null);
    const withNeutral = analyzeCandles(ltf, { trend: "NEUTRAL", adx: 10 });
    expect((noHtf === null) === (withNeutral === null)).toBe(true);
  });
});

describe("isEntryStillValid", () => {
  // BUY: entry=100, TP=110, SL=95
  it("narx kirish atrofida bo'lsa savdo dolzarb", () => {
    expect(isEntryStillValid("BUY", 100, 110, 95, 100)).toBe(true);
    expect(isEntryStillValid("BUY", 100, 110, 95, 99)).toBe(true);
    expect(isEntryStillValid("BUY", 100, 110, 95, 102)).toBe(true);
  });

  it("SL tomonga yarim yo'l bosilgan bo'lsa rad etiladi", () => {
    expect(isEntryStillValid("BUY", 100, 110, 95, 97.4)).toBe(false); // 2.5 = yarim SL masofasi
  });

  it("TP tomonga 30%+ ketgan bo'lsa rad etiladi (foyda qochgan)", () => {
    expect(isEntryStillValid("BUY", 100, 110, 95, 103.1)).toBe(false);
  });

  it("SELL uchun teskari ishlaydi", () => {
    // SELL: entry=100, TP=90, SL=105
    expect(isEntryStillValid("SELL", 100, 90, 105, 100)).toBe(true);
    expect(isEntryStillValid("SELL", 100, 90, 105, 102.6)).toBe(false); // SL tomonga yarim yo'l
    expect(isEntryStillValid("SELL", 100, 90, 105, 96.9)).toBe(false); // TP tomonga 30%+
  });

  it("noto'g'ri TP/SL joylashuvida rad etadi", () => {
    expect(isEntryStillValid("BUY", 100, 95, 110, 100)).toBe(false); // TP < entry, SL > entry
  });
});

describe("computeTrailedStop", () => {
  // BUY: entry=100, SL=95 → R=5
  const base = { direction: "BUY" as const, entryPrice: 100, initialStopLoss: 95 };

  it("1R foydagacha hech narsa o'zgartirmaydi", () => {
    expect(computeTrailedStop({ ...base, currentStopLoss: 95, currentPrice: 104, breakEvenApplied: false })).toBeNull();
  });

  it("1R foydada break-even taklif qiladi", () => {
    const advice = computeTrailedStop({ ...base, currentStopLoss: 95, currentPrice: 105, breakEvenApplied: false });
    expect(advice?.reason).toBe("BREAK_EVEN");
    expect(advice!.newStopLoss).toBeGreaterThan(100); // komissiya buferi bilan
    expect(advice!.newStopLoss).toBeLessThan(101);
  });

  it("break-even'dan keyin 1R orqada trailing qiladi (0.5R chegara bilan)", () => {
    // BE=100.2, narx 106 → kandidat 101 < 100.2+2.5 → hali yangilanmaydi
    expect(computeTrailedStop({ ...base, currentStopLoss: 100.2, currentPrice: 106, breakEvenApplied: true })).toBeNull();
    // narx 108 → kandidat 103 >= 100.2+2.5 → trail
    const advice = computeTrailedStop({ ...base, currentStopLoss: 100.2, currentPrice: 108, breakEvenApplied: true });
    expect(advice?.reason).toBe("TRAIL");
    expect(advice!.newStopLoss).toBe(103);
  });

  it("SELL (short) uchun teskari ishlaydi", () => {
    // entry=100, SL=105 → R=5; narx 95 = 1R foyda
    const advice = computeTrailedStop({
      direction: "SELL", entryPrice: 100, initialStopLoss: 105,
      currentStopLoss: 105, currentPrice: 95, breakEvenApplied: false,
    });
    expect(advice?.reason).toBe("BREAK_EVEN");
    expect(advice!.newStopLoss).toBeLessThan(100);

    const trail = computeTrailedStop({
      direction: "SELL", entryPrice: 100, initialStopLoss: 105,
      currentStopLoss: 99.8, currentPrice: 92, breakEvenApplied: true,
    });
    expect(trail?.reason).toBe("TRAIL");
    expect(trail!.newStopLoss).toBe(97);
  });

  it("noto'g'ri R (SL noto'g'ri tomonda) bo'lsa null", () => {
    expect(computeTrailedStop({ direction: "BUY", entryPrice: 100, initialStopLoss: 105, currentStopLoss: 105, currentPrice: 110, breakEvenApplied: false })).toBeNull();
  });
});
