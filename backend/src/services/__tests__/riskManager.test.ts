import { describe, expect, it } from "vitest";
import { computePositionSizeUsd, getRiskProfile, MAX_POSITION_FRACTION, MIN_POSITION_USD, RISK_PROFILES } from "../riskManager";

describe("computePositionSizeUsd", () => {
  it("SL masofasiga teskari proportsional pozitsiya hisoblaydi", () => {
    // Balans $10,000, risk 1%, SL 2% uzoqda -> pozitsiya = 100 / 0.02 = $5000,
    // lekin 25% konsentratsiya chegarasi -> $2500
    const size = computePositionSizeUsd({
      balanceUsd: 10_000,
      availableUsd: 10_000,
      entryPrice: 100,
      stopLoss: 98,
      riskPerTradeFraction: 0.01,
    });
    expect(size).toBe(10_000 * MAX_POSITION_FRACTION);
  });

  it("SL uzoq bo'lsa pozitsiya kichrayadi (risk doimiy qoladi)", () => {
    // SL 10% uzoqda -> pozitsiya = 100 / 0.10 = $1000 (chegaradan kichik)
    const size = computePositionSizeUsd({
      balanceUsd: 10_000,
      availableUsd: 10_000,
      entryPrice: 100,
      stopLoss: 90,
      riskPerTradeFraction: 0.01,
    });
    expect(size).toBe(1000);
    // SL ishlasa yo'qotish = pozitsiya * SL_masofa = 1000 * 0.10 = $100 = balansning 1%
    expect(size * 0.1).toBeCloseTo(10_000 * 0.01);
  });

  it("erkin kapitaldan oshmaydi", () => {
    const size = computePositionSizeUsd({
      balanceUsd: 10_000,
      availableUsd: 300,
      entryPrice: 100,
      stopLoss: 90,
      riskPerTradeFraction: 0.01,
    });
    expect(size).toBe(300);
  });

  it("juda kichik pozitsiyada 0 qaytaradi (savdo ochilmaydi)", () => {
    const size = computePositionSizeUsd({
      balanceUsd: 50,
      availableUsd: 5,
      entryPrice: 100,
      stopLoss: 95,
      riskPerTradeFraction: 0.01,
    });
    expect(size).toBe(0);
    expect(MIN_POSITION_USD).toBeGreaterThan(5);
  });

  it("SL kirish narxiga juda yaqin bo'lsa 0 qaytaradi (portlash himoyasi)", () => {
    const size = computePositionSizeUsd({
      balanceUsd: 10_000,
      availableUsd: 10_000,
      entryPrice: 100,
      stopLoss: 99.99, // 0.01% — juda yaqin
      riskPerTradeFraction: 0.01,
    });
    expect(size).toBe(0);
  });

  it("noto'g'ri kirishlarda 0 qaytaradi", () => {
    expect(computePositionSizeUsd({ balanceUsd: 0, availableUsd: 100, entryPrice: 100, stopLoss: 95, riskPerTradeFraction: 0.01 })).toBe(0);
    expect(computePositionSizeUsd({ balanceUsd: 100, availableUsd: 0, entryPrice: 100, stopLoss: 95, riskPerTradeFraction: 0.01 })).toBe(0);
    expect(computePositionSizeUsd({ balanceUsd: 100, availableUsd: 100, entryPrice: 0, stopLoss: 95, riskPerTradeFraction: 0.01 })).toBe(0);
    expect(computePositionSizeUsd({ balanceUsd: NaN, availableUsd: 100, entryPrice: 100, stopLoss: 95, riskPerTradeFraction: 0.01 })).toBe(0);
  });
});

describe("getRiskProfile", () => {
  it("mavjud darajalar uchun profil qaytaradi", () => {
    expect(getRiskProfile(1)).toBe(RISK_PROFILES[1]);
    expect(getRiskProfile(3)).toBe(RISK_PROFILES[3]);
  });

  it("noma'lum daraja uchun o'rta profilga tushadi", () => {
    expect(getRiskProfile(99)).toBe(RISK_PROFILES[2]);
    expect(getRiskProfile(0)).toBe(RISK_PROFILES[2]);
  });

  it("risk darajasi oshgani sari savdo boshiga risk ham oshadi", () => {
    expect(RISK_PROFILES[1].riskPerTradeFraction).toBeLessThan(RISK_PROFILES[2].riskPerTradeFraction);
    expect(RISK_PROFILES[2].riskPerTradeFraction).toBeLessThan(RISK_PROFILES[3].riskPerTradeFraction);
  });
});
