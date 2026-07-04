import { describe, expect, it } from "vitest";
import { applyContextToSignal, BTC_GUARD_THRESHOLD_PCT } from "../marketContext";

const neutral = { fearGreed: 50, btcChange1hPct: 0 };

describe("applyContextToSignal", () => {
  it("neytral kontekstda signal o'zgarmaydi", () => {
    const d = applyContextToSignal({ direction: "BUY", confidence: 75, symbol: "ETH/USDT", ctx: neutral });
    expect(d.allowed).toBe(true);
    expect(d.confidence).toBe(75);
    expect(d.notes).toHaveLength(0);
  });

  it("BTC keskin tushishida altcoin BUY bloklanadi", () => {
    const d = applyContextToSignal({
      direction: "BUY", confidence: 90, symbol: "SOL/USDT",
      ctx: { fearGreed: 50, btcChange1hPct: -BTC_GUARD_THRESHOLD_PCT },
    });
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toContain("BTC");
  });

  it("BTC keskin o'sishida altcoin SELL bloklanadi", () => {
    const d = applyContextToSignal({
      direction: "SELL", confidence: 90, symbol: "ADA/USDT",
      ctx: { fearGreed: 50, btcChange1hPct: 3 },
    });
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toContain("squeeze");
  });

  it("BTC'ning o'ziga BTC-himoya qo'llanmaydi", () => {
    const d = applyContextToSignal({
      direction: "BUY", confidence: 80, symbol: "BTC/USDT",
      ctx: { fearGreed: 50, btcChange1hPct: -5 },
    });
    expect(d.allowed).toBe(true);
  });

  it("ekstremal ochko'zlikda BUY ishonchi pasayadi, kontrarian SELL kuchayadi", () => {
    const buy = applyContextToSignal({ direction: "BUY", confidence: 75, symbol: "ETH/USDT", ctx: { fearGreed: 85, btcChange1hPct: 0 } });
    expect(buy.confidence).toBe(70);
    const sell = applyContextToSignal({ direction: "SELL", confidence: 75, symbol: "ETH/USDT", ctx: { fearGreed: 85, btcChange1hPct: 0 } });
    expect(sell.confidence).toBe(78);
  });

  it("ekstremal qo'rquvda SELL ishonchi pasayadi, kontrarian BUY kuchayadi", () => {
    const sell = applyContextToSignal({ direction: "SELL", confidence: 75, symbol: "ETH/USDT", ctx: { fearGreed: 10, btcChange1hPct: 0 } });
    expect(sell.confidence).toBe(70);
    const buy = applyContextToSignal({ direction: "BUY", confidence: 75, symbol: "ETH/USDT", ctx: { fearGreed: 10, btcChange1hPct: 0 } });
    expect(buy.confidence).toBe(78);
  });

  it("ekstremal musbat funding BUY ishonchini pasaytiradi", () => {
    const d = applyContextToSignal({
      direction: "BUY", confidence: 75, symbol: "ETH/USDT", ctx: neutral,
      fundingRate: 0.001, // 0.1%
    });
    expect(d.confidence).toBe(71);
    expect(d.notes[0]).toContain("Funding");
  });

  it("filtrlardan keyin ishonch juda pasaysa savdo bloklanadi", () => {
    const d = applyContextToSignal({
      direction: "BUY", confidence: 57, symbol: "ETH/USDT",
      ctx: { fearGreed: 85, btcChange1hPct: 0 },
      fundingRate: 0.001,
    });
    // 57 - 5 - 4 = 48 < 55 -> bloklanadi
    expect(d.allowed).toBe(false);
  });

  it("kontekst ma'lumotlari null bo'lsa hech narsa o'zgarmaydi", () => {
    const d = applyContextToSignal({
      direction: "SELL", confidence: 80, symbol: "ETH/USDT",
      ctx: { fearGreed: null, btcChange1hPct: null },
      fundingRate: null,
    });
    expect(d.allowed).toBe(true);
    expect(d.confidence).toBe(80);
  });
});
