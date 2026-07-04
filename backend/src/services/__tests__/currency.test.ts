import { describe, expect, it } from "vitest";
import { amountsMatch, usdToUzs } from "../currency";

describe("usdToUzs", () => {
  it("kurs bo'yicha konvertatsiya qiladi va butun songa yaxlitlaydi", () => {
    expect(usdToUzs(29, 12_500)).toBe(362_500);
    expect(usdToUzs(79, 12_650.5)).toBe(999_390); // 79 * 12650.5 = 999389.5 -> 999390
  });
});

describe("amountsMatch", () => {
  it("aniq mos summani qabul qiladi", () => {
    expect(amountsMatch(362_500, 362_500)).toBe(true);
  });

  it("1% ichidagi yaxlitlash farqini qabul qiladi", () => {
    expect(amountsMatch(362_500, 362_000)).toBe(true);
  });

  it("kam to'langan summani RAD ETADI (asosiy himoya)", () => {
    expect(amountsMatch(362_500, 100_000)).toBe(false);
    expect(amountsMatch(362_500, 358_000)).toBe(false); // ~1.24% kam
  });

  it("ortiqcha to'langan summani ham rad etadi (xato to'lov)", () => {
    expect(amountsMatch(362_500, 500_000)).toBe(false);
  });

  it("noto'g'ri qiymatlarni rad etadi", () => {
    expect(amountsMatch(362_500, NaN)).toBe(false);
    expect(amountsMatch(362_500, 0)).toBe(false);
    expect(amountsMatch(0, 362_500)).toBe(false);
    expect(amountsMatch(362_500, -362_500)).toBe(false);
  });
});
