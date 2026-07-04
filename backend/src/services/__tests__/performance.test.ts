import { describe, expect, it } from "vitest";
import { computePerformance } from "../performance";
import { getCachedPrice, __setCachedPrice } from "../priceFeed";

function trade(daysAgo: number, pnlUsd: number, symbol = "BTC/USDT", feeUsd = 0.5) {
  return {
    closedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    pnlUsd,
    feeUsd,
    symbol,
    direction: "BUY",
  };
}

describe("computePerformance", () => {
  it("bo'sh ro'yxatda nol statistika qaytaradi", () => {
    const p = computePerformance([], 1000);
    expect(p.totalTrades).toBe(0);
    expect(p.winRatePct).toBe(0);
    expect(p.profitFactor).toBeNull();
    expect(p.equityCurve).toHaveLength(0);
  });

  it("asosiy ko'rsatkichlarni to'g'ri hisoblaydi", () => {
    // 3 foyda (+100, +50, +50), 2 zarar (-40, -60): jami +100
    const trades = [trade(10, 100), trade(8, -40), trade(6, 50), trade(4, -60), trade(2, 50)];
    const p = computePerformance(trades, 1100); // hozirgi balans 1100 -> boshlang'ich 1000

    expect(p.totalTrades).toBe(5);
    expect(p.wins).toBe(3);
    expect(p.losses).toBe(2);
    expect(p.winRatePct).toBe(60);
    expect(p.totalPnlUsd).toBe(100);
    expect(p.startingCapitalUsd).toBe(1000);
    expect(p.profitFactor).toBe(2); // 200 / 100
    expect(p.avgWinUsd).toBeCloseTo(200 / 3, 1);
    expect(p.avgLossUsd).toBe(50);
    expect(p.expectancyUsd).toBe(20);
    expect(p.bestTradeUsd).toBe(100);
    expect(p.worstTradeUsd).toBe(-60);
    expect(p.totalFeesUsd).toBe(2.5);
  });

  it("drawdown'ni cho'qqidan pastga qarab hisoblaydi", () => {
    // 1000 -> 1100 -> 1040 -> 980 (cho'qqi 1100, tub 980 -> DD 120 / 10.9%)
    const trades = [trade(6, 100), trade(4, -60), trade(2, -60)];
    const p = computePerformance(trades, 980);
    expect(p.startingCapitalUsd).toBe(1000);
    expect(p.maxDrawdownUsd).toBe(120);
    expect(p.maxDrawdownPct).toBeCloseTo((120 / 1100) * 100, 1);
  });

  it("equity curve boshlang'ich kapitaldan boshlab kumulyativ boradi", () => {
    const trades = [trade(3, 100), trade(2, -50), trade(1, 25)];
    const p = computePerformance(trades, 1075);
    expect(p.equityCurve.map((e) => e.equity)).toEqual([1100, 1050, 1075]);
  });

  it("oylik va simvol kesimlarini to'g'ri guruhlaydi", () => {
    const trades = [
      trade(3, 100, "BTC/USDT"),
      trade(2, -30, "BTC/USDT"),
      trade(1, 40, "ETH/USDT"),
    ];
    const p = computePerformance(trades, 1110);

    const totalMonthlyPnl = p.monthly.reduce((s, m) => s + m.pnlUsd, 0);
    expect(totalMonthlyPnl).toBeCloseTo(110, 1);
    expect(p.monthly.reduce((s, m) => s + m.trades, 0)).toBe(3);

    const btc = p.bySymbol.find((s) => s.symbol === "BTC/USDT")!;
    expect(btc.trades).toBe(2);
    expect(btc.pnlUsd).toBe(70);
    expect(btc.winRatePct).toBe(50);
  });

  it("5 kundan kam ma'lumotda Sharpe null bo'ladi", () => {
    const p = computePerformance([trade(2, 10), trade(1, 20)], 1030);
    expect(p.sharpeRatio).toBeNull();
  });

  it("7+ kunlik ma'lumotda Sharpe hisoblanadi", () => {
    const trades = [1, 2, 3, 4, 5, 6, 7].map((d) => trade(d, d % 2 === 0 ? 15 : -5));
    const p = computePerformance(trades, 1025);
    expect(p.sharpeRatio).not.toBeNull();
    expect(Number.isFinite(p.sharpeRatio!)).toBe(true);
  });
});

describe("priceFeed kesh", () => {
  it("yangi narxni qaytaradi, eskirganini rad etadi", () => {
    __setCachedPrice("TEST/USDT", 123.45);
    expect(getCachedPrice("TEST/USDT")).toBe(123.45);

    __setCachedPrice("OLD/USDT", 99, Date.now() - 60_000); // 60s eski
    expect(getCachedPrice("OLD/USDT")).toBeNull();

    expect(getCachedPrice("YOQ/USDT")).toBeNull();
  });
});
