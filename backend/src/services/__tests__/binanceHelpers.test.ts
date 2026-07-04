import { describe, expect, it } from "vitest";
import { averageFillPrice, floorToStep, sellableQuantity } from "../exchanges/binance";

describe("floorToStep", () => {
  it("miqdorni qadamga pastga yaxlitlaydi", () => {
    expect(floorToStep(0.123456, 0.001)).toBe(0.123);
    expect(floorToStep(1.999, 0.01)).toBe(1.99);
    expect(floorToStep(105.7, 0.1)).toBe(105.7);
  });

  it("floating-point xatolariga chidamli", () => {
    // 0.1 + 0.2 = 0.30000000000000004 kabi holatlar qadam buzmasligi kerak
    expect(floorToStep(0.30000000000000004, 0.1)).toBe(0.3);
    expect(floorToStep(2.675, 0.001)).toBe(2.675);
  });

  it("qadam 0 yoki manfiy bo'lsa qiymatni o'zgartirmaydi", () => {
    expect(floorToStep(1.2345, 0)).toBe(1.2345);
  });
});

describe("sellableQuantity", () => {
  it("asosiy aktivda ushlab qolingan komissiyani ayiradi", () => {
    const fills = [
      { price: "100", qty: "1.0", commission: "0.001", commissionAsset: "BTC" },
      { price: "101", qty: "0.5", commission: "0.0005", commissionAsset: "BTC" },
    ];
    expect(sellableQuantity(1.5, fills, "BTC")).toBeCloseTo(1.4985);
  });

  it("USDT/BNB'da to'langan komissiyani ayirmaydi", () => {
    const fills = [
      { price: "100", qty: "1.0", commission: "0.1", commissionAsset: "USDT" },
      { price: "100", qty: "0.5", commission: "0.01", commissionAsset: "BNB" },
    ];
    expect(sellableQuantity(1.5, fills, "BTC")).toBe(1.5);
  });

  it("fills bo'lmasa bajarilgan miqdorni qaytaradi", () => {
    expect(sellableQuantity(2.5, undefined, "BTC")).toBe(2.5);
  });
});

describe("averageFillPrice", () => {
  it("miqdorga vaznlangan o'rtacha narxni hisoblaydi", () => {
    const fills = [
      { price: "100", qty: "1" },
      { price: "110", qty: "1" },
    ];
    expect(averageFillPrice(fills)).toBe(105);
  });

  it("bo'sh fills uchun null qaytaradi", () => {
    expect(averageFillPrice([])).toBeNull();
    expect(averageFillPrice(undefined)).toBeNull();
  });
});
