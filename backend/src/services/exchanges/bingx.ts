import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";
import { ExchangeAdapter, ExchangeApiError, ExchangeCredentials, OrderResult } from "./types";

/**
 * BingX Spot REST integratsiyasi.
 * EXCHANGE_MODE="testnet" -> BingX VST (Virtual Simulated Trading) muhiti
 * (sun'iy mablag'), EXCHANGE_MODE="live" -> open-api.bingx.com (HAQIQIY mablag').
 */

const BASE_URL = env.exchangeMode === "live" ? "https://open-api.bingx.com" : "https://open-api-vst.bingx.com";

function toSymbol(symbol: string): string {
  return symbol.replace("/", "-").toUpperCase();
}

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

function buildQuery(params: Record<string, string | number>): string {
  const entries = Object.entries(params).map(([key, value]) => [key, String(value)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

function isOk(data: any): boolean {
  // BingX ba'zi endpointlarda code maydonini umuman qaytarmaydi (muvaffaqiyatli bo'lsa)
  return data?.code === undefined || data.code === 0;
}

async function publicGet(path: string, params: Record<string, string>): Promise<any> {
  const query = buildQuery(params);
  const res = await fetch(`${BASE_URL}${path}?${query}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !isOk(data)) {
    throw new ExchangeApiError(data?.msg ?? `BingX so'rovi muvaffaqiyatsiz tugadi (HTTP ${res.status})`, res.status, data?.code);
  }
  return data.data;
}

async function signedRequest(path: string, method: "GET" | "POST", creds: ExchangeCredentials, params: Record<string, string | number> = {}): Promise<any> {
  const query = buildQuery({ ...params, timestamp: Date.now() });
  const signature = sign(query, creds.apiSecret);
  const url = `${BASE_URL}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, { method, headers: { "X-BX-APIKEY": creds.apiKey } });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !isOk(data)) {
    const message =
      typeof data?.msg === "string" && data.msg
        ? data.msg
        : `BingX so'rovi rad etildi (HTTP ${res.status}). API kalit/maxfiy so'z yoki ruxsatlarni tekshiring.`;
    throw new ExchangeApiError(message, res.status, data?.code);
  }
  return data.data;
}

async function fetchPrice(symbol: string): Promise<number> {
  return withRateLimit("bingx:public", async () => {
    const data = await publicGet("/openApi/spot/v1/ticker/price", { symbol: toSymbol(symbol) });
    const price = Number(Array.isArray(data) ? data[0]?.price : data?.price);
    if (!Number.isFinite(price) || price <= 0) throw new ExchangeApiError("BingX noto'g'ri narx qaytardi", 502);
    return price;
  });
}

async function fetchQuoteBalance(creds: ExchangeCredentials): Promise<number> {
  return withRateLimit(`bingx:${creds.apiKey}`, async () => {
    const data = await signedRequest("/openApi/spot/v1/account/balance", "GET", creds);
    const balances: Array<{ asset: string; free: string }> = data?.balances ?? [];
    const usdt = balances.find((b) => b.asset === "USDT");
    return usdt ? Number(Number(usdt.free).toFixed(2)) : 0;
  });
}

async function resolveOrderResult(creds: ExchangeCredentials, symbol: string, orderId: string): Promise<OrderResult> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const data = await signedRequest("/openApi/spot/v1/trade/query", "GET", creds, { symbol: toSymbol(symbol), orderId });
  const order = data?.order ?? data;
  const executedQty = Number(order?.executedQty ?? 0);
  const cumQuote = Number(order?.cummulativeQuoteQty ?? 0);
  const avgPrice = executedQty > 0 && cumQuote > 0 ? Number((cumQuote / executedQty).toFixed(8)) : null;
  return { orderId: String(orderId), executedQty, avgPrice };
}

async function placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult> {
  return withRateLimit(`bingx:${creds.apiKey}`, async () => {
    const data = await signedRequest("/openApi/spot/v1/trade/order", "POST", creds, {
      symbol: toSymbol(symbol),
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: quoteAmount.toFixed(2),
    });
    const orderId = data?.orderId ?? data?.order?.orderId;
    return resolveOrderResult(creds, symbol, orderId);
  });
}

async function placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult> {
  return withRateLimit(`bingx:${creds.apiKey}`, async () => {
    const data = await signedRequest("/openApi/spot/v1/trade/order", "POST", creds, {
      symbol: toSymbol(symbol),
      side: "SELL",
      type: "MARKET",
      quantity: baseQuantity,
    });
    const orderId = data?.orderId ?? data?.order?.orderId;
    return resolveOrderResult(creds, symbol, orderId);
  });
}

export const bingxAdapter: ExchangeAdapter = {
  id: "BingX",
  requiresPassphrase: false,
  toSymbol,
  fetchPrice,
  fetchQuoteBalance,
  placeMarketBuy,
  placeMarketSell,
};
