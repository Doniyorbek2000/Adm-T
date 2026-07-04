/**
 * USD/UZS kursi — O'zbekiston Markaziy banki (CBU) rasmiy API'sidan olinadi
 * va keshlanadi. API ishlamay qolsa, oxirgi muvaffaqiyatli kurs (yoki zaxira
 * qiymat) ishlatiladi — to'lov oqimi hech qachon kurs sababli to'xtamaydi.
 */

const CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 soat
const FALLBACK_RATE = 12_500;

let cachedRate: number | null = null;
let cachedAt = 0;

export async function getUsdUzsRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRate;

  try {
    const res = await fetch(CBU_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`CBU HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ Ccy?: string; Rate?: string }>;
    const usd = Array.isArray(data) ? data.find((d) => d.Ccy === "USD") ?? data[0] : null;
    const rate = Number(usd?.Rate);
    if (!Number.isFinite(rate) || rate < 5_000 || rate > 100_000) {
      throw new Error(`CBU noto'g'ri kurs qaytardi: ${usd?.Rate}`);
    }
    cachedRate = rate;
    cachedAt = Date.now();
    return rate;
  } catch (err) {
    console.warn(
      `[Currency] CBU kursini olishda xato (${err instanceof Error ? err.message : err}) — ` +
      `${cachedRate ? "eski keshlangan" : "zaxira"} kurs ishlatiladi`
    );
    return cachedRate ?? FALLBACK_RATE;
  }
}

export function usdToUzs(amountUsd: number, rate: number): number {
  return Math.round(amountUsd * rate);
}

/**
 * Webhook'dan kelgan summa kutilgan summaga mosligini tekshiradi.
 * Kichik farqlarga (yaxlitlash) 1% chegara qo'yiladi.
 */
export function amountsMatch(expectedUzs: number, receivedUzs: number, tolerancePct = 1): boolean {
  if (!Number.isFinite(expectedUzs) || !Number.isFinite(receivedUzs)) return false;
  if (expectedUzs <= 0 || receivedUzs <= 0) return false;
  const diffPct = (Math.abs(receivedUzs - expectedUzs) / expectedUzs) * 100;
  return diffPct <= tolerancePct;
}
