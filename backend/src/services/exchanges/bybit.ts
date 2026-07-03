import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";
import { ExchangeAdapter, ExchangeApiError, ExchangeCredentials, OrderResult } from "./types";

/**
 * Bybit V5 (Unified Trading Account) REST integratsiyasi.
 * EXCHANGE_MODE="testnet" -> api-testnet.bybit.com (sun'iy mablag'),
 * EXCHANGE_MODE="live" -> api.bybit.com (HAQIQIY mablag').
 */

const BASE_URL = env.exchangeMode === "live" ? "https://api.bybit.com" : "https://api-testnet.bybit.com";
const RECV_WINDOW = "5000";

function toSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function publicGet(path: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${path}?${query}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.retCode !== 0) {
    throw new ExchangeApiError(data?.retMsg ?? `Bybit so'rovi muvaffaqiyatsiz tugadi (HTTP ${res.status})`, res.status, data?.retCode);
  }
  return data.result;
}

async function signedRequest(path: string, method: "GET" | "POST", creds: ExchangeCredentials, params: Record<string, unknown>): Promise<any> {
  const timestamp = Date.now().toString();
  let payload: string;
  let url: string;
  let body: string | undefined;

  if (method === "GET") {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    payload = timestamp + creds.apiKey + RECV_WINDOW + query;
    url = `${BASE_URL}${path}${query ? `?${query}` : ""}`;
  } else {
    body = JSON.stringify(params);
    payload = timestamp + creds.apiKey + RECV_WINDOW + body;
    url = `${BASE_URL}${path}`;
  }

  const signature = sign(payload, creds.apiSecret);
  const res = await fetch(url, {
    method,
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-SIGN": signature,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "Content-Type": "application/json",
    },
    body,
  });

  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.retCode !== 0) {
    const message =
      typeof data?.retMsg === "string"
        ? data.retMsg
        : `Bybit so'rovi rad etildi (HTTP ${res.status}). API kalit/maxfiy so'z yoki ruxsatlarni tekshiring.`;
    throw new ExchangeApiError(message, res.status, data?.retCode);
  }
  return data.result;
}

async function fetchPrice(symbol: string): Promise<number> {
  return withRateLimit("bybit:public", async () => {
    const result = await publicGet("/v5/market/tickers", { category: "spot", symbol: toSymbol(symbol) });
    const price = Number(result?.list?.[0]?.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new ExchangeApiError("Bybit noto'g'ri narx qaytardi", 502);
    return price;
  });
}

async function fetchQuoteBalance(creds: ExchangeCredentials): Promise<number> {
  return withRateLimit(`bybit:${creds.apiKey}`, async () => {
    const result = await signedRequest("/v5/account/wallet-balance", "GET", creds, { accountType: "UNIFIED" });
    const coins: Array<{ coin: string; walletBalance: string }> = result?.list?.[0]?.coin ?? [];
    const usdt = coins.find((c) => c.coin === "USDT");
    return usdt ? Number(Number(usdt.walletBalance).toFixed(2)) : 0;
  });
}

async function resolveOrderResult(creds: ExchangeCredentials, orderId: string): Promise<OrderResult> {
  // Bozor buyurtmasi deyarli bir zumda bajariladi - real bajarilgan miqdor va
  // narxni olish uchun qisqa kechikishdan so'ng holatini so'raymiz
  await new Promise((resolve) => setTimeout(resolve, 700));
  const result = await signedRequest("/v5/order/realtime", "GET", creds, { category: "spot", orderId });
  const order = result?.list?.[0];
  const executedQty = Number(order?.cumExecQty ?? 0);
  const cumValue = Number(order?.cumExecValue ?? 0);
  const avgPrice = executedQty > 0 ? Number((cumValue / executedQty).toFixed(8)) : null;
  return { orderId, executedQty, avgPrice };
}

async function placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult> {
  return withRateLimit(`bybit:${creds.apiKey}`, async () => {
    const result = await signedRequest("/v5/order/create", "POST", creds, {
      category: "spot",
      symbol: toSymbol(symbol),
      side: "Buy",
      orderType: "Market",
      marketUnit: "quoteCoin", // qty - sarflanadigan USDT miqdori
      qty: quoteAmount.toFixed(2),
    });
    return resolveOrderResult(creds, result.orderId);
  });
}

async function placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult> {
  return withRateLimit(`bybit:${creds.apiKey}`, async () => {
    const result = await signedRequest("/v5/order/create", "POST", creds, {
      category: "spot",
      symbol: toSymbol(symbol),
      side: "Sell",
      orderType: "Market",
      marketUnit: "baseCoin", // qty - sotiladigan asosiy aktiv miqdori
      qty: baseQuantity.toString(),
    });
    return resolveOrderResult(creds, result.orderId);
  });
}

export const bybitAdapter: ExchangeAdapter = {
  id: "Bybit",
  requiresPassphrase: false,
  toSymbol,
  fetchPrice,
  fetchQuoteBalance,
  placeMarketBuy,
  placeMarketSell,
};
