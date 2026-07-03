import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";

/**
 * Binance USDT-M Futures (fapi) integratsiyasi.
 *
 * Nima uchun futures? Spot hisobda SELL signalini bajarish ("shortlash")
 * imkonsiz. Futures hisobda esa AI ham BUY (long), ham SELL (short)
 * pozitsiyalarini ocha oladi — strategiyaning to'liq salohiyati ishlaydi.
 *
 * Xavfsizlik tamoyillari:
 *  - Kichik leverage (standart 3x, FUTURES_LEVERAGE env bilan sozlanadi) —
 *    likvidatsiya xavfini minimallashtirish uchun. Pozitsiya o'lchami baribir
 *    risk-menejer tomonidan SL masofasiga qarab hisoblanadi.
 *  - Har pozitsiyaga birja tomonida TP (TAKE_PROFIT_MARKET) va SL
 *    (STOP_MARKET) closePosition buyurtmalari qo'yiladi — server o'chsa ham
 *    pozitsiya himoyalangan.
 *  - SL/TP MARK_PRICE bo'yicha ishlaydi — bir lahzalik "scam wick" larga
 *    chidamliroq.
 *  - EXCHANGE_MODE=testnet bo'lsa barcha so'rovlar Binance futures
 *    testnet'iga boradi (sun'iy mablag').
 */

const BASE_URL =
  env.exchangeMode === "live" ? "https://fapi.binance.com" : "https://testnet.binancefuture.com";

export class BinanceFuturesApiError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "BinanceFuturesApiError";
    this.status = status;
    this.code = code;
  }
}

export interface FuturesCredentials {
  apiKey: string;
  apiSecret: string;
}

function toFuturesSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signedRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  creds: FuturesCredentials,
  params: Record<string, string | number | boolean> = {}
): Promise<any> {
  const entries = Object.entries({ ...params, timestamp: Date.now(), recvWindow: 5000 }).map(
    ([k, v]) => [k, String(v)] as [string, string]
  );
  const query = new URLSearchParams(entries).toString();
  const signature = sign(query, creds.apiSecret);
  const url = `${BASE_URL}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": creds.apiKey } });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // JSON bo'lmagan javob — quyida umumiy xato sifatida qaytariladi
  }

  if (!res.ok) {
    const message =
      typeof data?.msg === "string"
        ? data.msg
        : `Binance Futures so'rovi rad etildi (HTTP ${res.status})`;
    throw new BinanceFuturesApiError(message, res.status, data?.code);
  }
  return data;
}

async function publicGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ""}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BinanceFuturesApiError(data?.msg ?? `Futures so'rovi muvaffaqiyatsiz (HTTP ${res.status})`, res.status, data?.code);
  }
  return data;
}

/* ─── Simvol filtrlari (narx/miqdor qadamlari) ──────────────────────────────── */

export interface FuturesSymbolFilters {
  tickSize: number;
  stepSize: number;
  minNotional: number;
}

const filtersCache = new Map<string, { filters: FuturesSymbolFilters; fetchedAt: number }>();
const FILTERS_TTL_MS = 12 * 60 * 60 * 1000;

export async function futuresGetFilters(symbol: string): Promise<FuturesSymbolFilters> {
  const fSymbol = toFuturesSymbol(symbol);
  const cached = filtersCache.get(fSymbol);
  if (cached && Date.now() - cached.fetchedAt < FILTERS_TTL_MS) return cached.filters;

  const data = await withRateLimit("binance-futures:public", () =>
    publicGet("/fapi/v1/exchangeInfo", { symbol: fSymbol })
  );
  const info = data?.symbols?.find((s: any) => s.symbol === fSymbol) ?? data?.symbols?.[0];
  if (!info) throw new BinanceFuturesApiError(`${symbol} uchun futures exchangeInfo topilmadi`, 502);

  const priceFilter = info.filters?.find((f: any) => f.filterType === "PRICE_FILTER");
  const lotFilter = info.filters?.find((f: any) => f.filterType === "LOT_SIZE");
  const notionalFilter = info.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL");

  const filters: FuturesSymbolFilters = {
    tickSize: Number(priceFilter?.tickSize) || 0.00000001,
    stepSize: Number(lotFilter?.stepSize) || 0.00000001,
    minNotional: Number(notionalFilter?.notional) || 5,
  };
  filtersCache.set(fSymbol, { filters, fetchedAt: Date.now() });
  return filters;
}

/* ─── Balans va leverage ────────────────────────────────────────────────────── */

/** Futures hisobdagi erkin USDT balans */
export async function futuresAvailableUsdt(creds: FuturesCredentials): Promise<number> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v2/balance", "GET", creds);
    const usdt = (data as Array<{ asset: string; availableBalance: string }>).find((b) => b.asset === "USDT");
    return usdt ? Number(Number(usdt.availableBalance).toFixed(2)) : 0;
  });
}

/** Umumiy futures USDT balans (marja + erkin) — hisob balansini ko'rsatish uchun */
export async function futuresTotalUsdt(creds: FuturesCredentials): Promise<number> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v2/balance", "GET", creds);
    const usdt = (data as Array<{ asset: string; balance: string }>).find((b) => b.asset === "USDT");
    return usdt ? Number(Number(usdt.balance).toFixed(2)) : 0;
  });
}

export async function futuresSetLeverage(creds: FuturesCredentials, symbol: string, leverage: number): Promise<void> {
  await withRateLimit(`binance-futures:${creds.apiKey}`, () =>
    signedRequest("/fapi/v1/leverage", "POST", creds, {
      symbol: toFuturesSymbol(symbol),
      leverage: Math.max(1, Math.min(20, Math.round(leverage))),
    })
  );
}

/* ─── Pozitsiya ochish/yopish ───────────────────────────────────────────────── */

export interface FuturesOrderResult {
  orderId: string;
  executedQty: number;
  avgPrice: number | null;
}

/** Bozor buyurtmasi bilan pozitsiya ochish: BUY = long, SELL = short */
export async function futuresOpenPosition(
  creds: FuturesCredentials,
  symbol: string,
  direction: "BUY" | "SELL",
  quantity: number
): Promise<FuturesOrderResult> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v1/order", "POST", creds, {
      symbol: toFuturesSymbol(symbol),
      side: direction,
      type: "MARKET",
      quantity,
      newOrderRespType: "RESULT",
    });
    return {
      orderId: String(data?.orderId ?? ""),
      executedQty: Number(data?.executedQty) || 0,
      avgPrice: Number(data?.avgPrice) > 0 ? Number(data.avgPrice) : null,
    };
  });
}

/** Pozitsiyani qarama-qarshi bozor buyurtmasi bilan yopish (reduceOnly) */
export async function futuresClosePosition(
  creds: FuturesCredentials,
  symbol: string,
  positionDirection: "BUY" | "SELL",
  quantity: number
): Promise<FuturesOrderResult> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v1/order", "POST", creds, {
      symbol: toFuturesSymbol(symbol),
      side: positionDirection === "BUY" ? "SELL" : "BUY",
      type: "MARKET",
      quantity,
      reduceOnly: true,
      newOrderRespType: "RESULT",
    });
    return {
      orderId: String(data?.orderId ?? ""),
      executedQty: Number(data?.executedQty) || 0,
      avgPrice: Number(data?.avgPrice) > 0 ? Number(data.avgPrice) : null,
    };
  });
}

/* ─── Himoya buyurtmalari (birja tomonidagi TP/SL) ──────────────────────────── */

export interface FuturesProtectionIds {
  tpOrderId: string;
  slOrderId: string;
}

/**
 * Pozitsiyani himoyalovchi TP va SL buyurtmalarini joylashtiradi.
 * closePosition=true — ishlaganda BUTUN pozitsiyani yopadi, ikkinchisi esa
 * pozitsiya yo'qligi sababli o'z-o'zidan bekor bo'ladi (yoki sync bosqichida
 * cancelAll bilan tozalanadi). MARK_PRICE — soxta piklarga chidamli.
 */
export async function futuresPlaceProtection(
  creds: FuturesCredentials,
  symbol: string,
  positionDirection: "BUY" | "SELL",
  takeProfit: number,
  stopLoss: number
): Promise<FuturesProtectionIds> {
  const closeSide = positionDirection === "BUY" ? "SELL" : "BUY";
  const fSymbol = toFuturesSymbol(symbol);

  const tp = await withRateLimit(`binance-futures:${creds.apiKey}`, () =>
    signedRequest("/fapi/v1/order", "POST", creds, {
      symbol: fSymbol,
      side: closeSide,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: takeProfit,
      closePosition: true,
      workingType: "MARK_PRICE",
    })
  );

  try {
    const sl = await withRateLimit(`binance-futures:${creds.apiKey}`, () =>
      signedRequest("/fapi/v1/order", "POST", creds, {
        symbol: fSymbol,
        side: closeSide,
        type: "STOP_MARKET",
        stopPrice: stopLoss,
        closePosition: true,
        workingType: "MARK_PRICE",
      })
    );
    return { tpOrderId: String(tp?.orderId ?? ""), slOrderId: String(sl?.orderId ?? "") };
  } catch (err) {
    // SL joylashmasa TP ham bekor qilinadi — pozitsiya "yarim himoyalangan"
    // holatda qolmasligi kerak (SL himoyasiz TP xavfli)
    try {
      await futuresCancelAllOrders(creds, symbol);
    } catch {
      // tozalash xatosi asl xatoni yashirmasin
    }
    throw err;
  }
}

/** Simvol bo'yicha BARCHA ochiq buyurtmalarni bekor qilish (TP/SL tozalash) */
export async function futuresCancelAllOrders(creds: FuturesCredentials, symbol: string): Promise<void> {
  await withRateLimit(`binance-futures:${creds.apiKey}`, () =>
    signedRequest("/fapi/v1/allOpenOrders", "DELETE", creds, { symbol: toFuturesSymbol(symbol) })
  );
}

/* ─── Pozitsiya holati va realized PnL ──────────────────────────────────────── */

/** Joriy pozitsiya miqdori (imzoli: long musbat, short manfiy, 0 = yopiq) */
export async function futuresPositionAmt(creds: FuturesCredentials, symbol: string): Promise<number> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v2/positionRisk", "GET", creds, { symbol: toFuturesSymbol(symbol) });
    const pos = Array.isArray(data) ? data[0] : data;
    return Number(pos?.positionAmt) || 0;
  });
}

export interface FuturesRealizedResult {
  pnlUsd: number;
  feeUsd: number;
  lastPrice: number | null;
}

/**
 * Berilgan vaqtdan beri simvol bo'yicha realized PnL va komissiyalarni
 * yig'adi (userTrades'dan) — pozitsiya birja tomonidagi TP/SL bilan yopilganda
 * haqiqiy natijani DB'ga yozish uchun.
 */
export async function futuresRealizedPnl(
  creds: FuturesCredentials,
  symbol: string,
  sinceMs: number
): Promise<FuturesRealizedResult> {
  return withRateLimit(`binance-futures:${creds.apiKey}`, async () => {
    const data = await signedRequest("/fapi/v1/userTrades", "GET", creds, {
      symbol: toFuturesSymbol(symbol),
      startTime: sinceMs,
      limit: 1000,
    });
    const trades: Array<{ realizedPnl: string; commission: string; commissionAsset: string; price: string }> =
      Array.isArray(data) ? data : [];

    let pnl = 0;
    let fee = 0;
    let lastPrice: number | null = null;
    for (const t of trades) {
      pnl += Number(t.realizedPnl) || 0;
      if (t.commissionAsset === "USDT") fee += Number(t.commission) || 0;
      const p = Number(t.price);
      if (Number.isFinite(p) && p > 0) lastPrice = p;
    }
    return { pnlUsd: Number(pnl.toFixed(2)), feeUsd: Number(fee.toFixed(4)), lastPrice };
  });
}
