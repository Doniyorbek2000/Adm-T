import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";

/**
 * Binance bilan haqiqiy REST integratsiya.
 *
 * EXCHANGE_MODE muhit o'zgaruvchisi orqali boshqariladi:
 *  - "testnet" (standart) -> https://testnet.binance.vision - Binance'ning
 *    rasmiy sinov muhiti, sun'iy (test) mablag' bilan ishlaydi, REAL pulga
 *    hech qanday ta'sir qilmaydi. Yangi integratsiyani sinash uchun ishlatiladi.
 *  - "live" -> https://api.binance.com - HAQIQIY birja, REAL foydalanuvchi
 *    mablag'i bilan ishlaydi. Faqat to'liq sinovdan o'tgach, ongli ravishda
 *    yoqilishi kerak.
 *
 * Xavfsizlik bo'yicha eslatmalar:
 *  - API kalit/maxfiy so'z hech qachon logga yozilmaydi yoki xato xabarlarida
 *    qaytarilmaydi.
 *  - Barcha autentifikatsiyalangan so'rovlar HMAC-SHA256 imzo bilan yuboriladi
 *    (Binance talabiga muvofiq).
 *  - So'rovlar withRateLimit orqali navbatga olinadi - chastotani oshirib,
 *    hisobni bloklab qo'ymaslik uchun.
 */

const BASE_URL = env.exchangeMode === "live" ? "https://api.binance.com" : "https://testnet.binance.vision";

export class BinanceApiError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "BinanceApiError";
    this.status = status;
    this.code = code;
  }
}

function toBinanceSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function publicGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url);
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BinanceApiError(data?.msg ?? `Binance so'rovi muvaffaqiyatsiz tugadi (HTTP ${res.status})`, res.status, data?.code);
  }
  return data;
}

function buildQuery(params: Record<string, string | number>): string {
  const entries = Object.entries(params).map(([key, value]) => [key, String(value)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

async function signedRequest(
  path: string,
  method: "GET" | "POST",
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number> = {}
) {
  const query = buildQuery({ ...params, timestamp: Date.now(), recvWindow: 5000 });
  const signature = sign(query, apiSecret);
  const url = `${BASE_URL}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": apiKey } });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Binance JSON bo'lmagan javob qaytarsa - matnni xato sifatida ko'rsatamiz
  }

  if (!res.ok) {
    const message =
      typeof data?.msg === "string"
        ? data.msg
        : `Binance so'rovi rad etildi (HTTP ${res.status}). API kalit/maxfiy so'z yoki ruxsatlarni tekshiring.`;
    throw new BinanceApiError(message, res.status, data?.code);
  }

  return data;
}

/** Joriy bozor narxini Binance'ning ommaviy (autentifikatsiyasiz) endpointidan olish */
export async function fetchSpotPrice(symbol: string): Promise<number> {
  return withRateLimit("binance:public", async () => {
    const data = await publicGet("/api/v3/ticker/price", { symbol: toBinanceSymbol(symbol) });
    const price = Number(data?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BinanceApiError("Binance noto'g'ri narx qaytardi", 502);
    }
    return price;
  });
}

/**
 * API kalit/maxfiy so'zni tekshirish va USDT (asosiy savdo valyutasi) erkin
 * balansini olish. Hisob ulanganda kalitlar haqiqiyligini tasdiqlash va
 * keyinchalik balansni birja bilan sinxronlashtirish uchun ishlatiladi.
 */
export async function fetchUsdtBalance(apiKey: string, apiSecret: string): Promise<number> {
  return withRateLimit(`binance:${apiKey}`, async () => {
    const data = await signedRequest("/api/v3/account", "GET", apiKey, apiSecret);
    const balances: Array<{ asset: string; free: string; locked: string }> = data?.balances ?? [];
    const usdt = balances.find((b) => b.asset === "USDT");
    if (!usdt) return 0;
    return Number((Number(usdt.free) + Number(usdt.locked)).toFixed(2));
  });
}

export interface BinanceOrderFill {
  price: string;
  qty: string;
}

export interface BinanceOrderResult {
  orderId: number;
  status: string;
  executedQty: string;
  fills?: BinanceOrderFill[];
}

/**
 * Haqiqiy (yoki testnet) bozor buyurtmasini joylashtiradi - bu funksiya
 * chaqirilganda DARHOL haqiqiy/sinov mablag'i bilan savdo amalga oshadi.
 *
 * - BUY uchun `quoteOrderQty` (qancha USDT sarflash) beriladi - Binance
 *   miqdorni o'zi hisoblaydi (lot-size aniqligi muammosini oldini oladi).
 * - SELL uchun `quantity` (qancha asosiy aktiv sotish) beriladi - odatda
 *   avval BUY orqali olingan miqdorni yopish uchun ishlatiladi.
 */
export async function placeMarketOrder(params: {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  quoteOrderQty?: number;
  quantity?: number;
}): Promise<BinanceOrderResult> {
  const orderParams: Record<string, string | number> = {
    symbol: toBinanceSymbol(params.symbol),
    side: params.side,
    type: "MARKET",
  };

  if (params.quantity !== undefined) {
    orderParams.quantity = params.quantity;
  } else if (params.quoteOrderQty !== undefined) {
    orderParams.quoteOrderQty = params.quoteOrderQty.toFixed(2);
  } else {
    throw new Error("placeMarketOrder: quantity yoki quoteOrderQty ko'rsatilishi shart");
  }

  return withRateLimit(`binance:${params.apiKey}`, () =>
    signedRequest("/api/v3/order", "POST", params.apiKey, params.apiSecret, orderParams)
  );
}

/** Buyurtma to'ldirilishlaridan (fills) o'rtacha bajarilish narxini hisoblaydi */
export function averageFillPrice(fills?: BinanceOrderFill[]): number | null {
  if (!fills || fills.length === 0) return null;
  let totalQty = 0;
  let totalCost = 0;
  for (const fill of fills) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    totalQty += qty;
    totalCost += qty * price;
  }
  return totalQty > 0 ? Number((totalCost / totalQty).toFixed(8)) : null;
}

export function exchangeMode(): "testnet" | "live" {
  return env.exchangeMode;
}

export function isLiveTrading(): boolean {
  return env.exchangeMode === "live";
}
