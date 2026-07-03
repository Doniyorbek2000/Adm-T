import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";
import { ExchangeAdapter, ExchangeApiError, ExchangeCredentials, OrderResult } from "./types";

/**
 * KuCoin REST integratsiyasi (API v2 autentifikatsiyasi - passphrase ham
 * maxfiy so'z bilan shifrlanib yuborilishi shart).
 * EXCHANGE_MODE="testnet" -> openapi-sandbox.kucoin.com (sun'iy mablag'),
 * EXCHANGE_MODE="live" -> api.kucoin.com (HAQIQIY mablag').
 */

const BASE_URL = env.exchangeMode === "live" ? "https://api.kucoin.com" : "https://openapi-sandbox.kucoin.com";

function toSymbol(symbol: string): string {
  return symbol.replace("/", "-").toUpperCase();
}

function base64Hmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

async function publicGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.code !== "200000") {
    throw new ExchangeApiError(data?.msg ?? `KuCoin so'rovi muvaffaqiyatsiz tugadi (HTTP ${res.status})`, res.status, data?.code);
  }
  return data.data;
}

async function signedRequest(path: string, method: "GET" | "POST", creds: ExchangeCredentials, params: Record<string, unknown> = {}): Promise<any> {
  const timestamp = Date.now().toString();
  let endpoint = path;
  let body = "";

  if (method === "GET") {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    endpoint = query ? `${path}?${query}` : path;
  } else {
    body = JSON.stringify(params);
  }

  const strToSign = timestamp + method + endpoint + body;
  const signature = base64Hmac(strToSign, creds.apiSecret);
  // KC-API v2: passphrase ham API maxfiy so'zi bilan shifrlanib yuboriladi
  const encryptedPassphrase = base64Hmac(creds.passphrase ?? "", creds.apiSecret);

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      "KC-API-KEY": creds.apiKey,
      "KC-API-SIGN": signature,
      "KC-API-TIMESTAMP": timestamp,
      "KC-API-PASSPHRASE": encryptedPassphrase,
      "KC-API-KEY-VERSION": "2",
      "Content-Type": "application/json",
    },
    body: method === "POST" ? body : undefined,
  });

  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.code !== "200000") {
    const message =
      typeof data?.msg === "string" && data.msg
        ? data.msg
        : `KuCoin so'rovi rad etildi (HTTP ${res.status}). API kalit/maxfiy so'z/passphrase yoki ruxsatlarni tekshiring.`;
    throw new ExchangeApiError(message, res.status, data?.code);
  }
  return data.data;
}

async function fetchPrice(symbol: string): Promise<number> {
  return withRateLimit("kucoin:public", async () => {
    const data = await publicGet(`/api/v1/market/orderbook/level1?symbol=${toSymbol(symbol)}`);
    const price = Number(data?.price);
    if (!Number.isFinite(price) || price <= 0) throw new ExchangeApiError("KuCoin noto'g'ri narx qaytardi", 502);
    return price;
  });
}

async function fetchQuoteBalance(creds: ExchangeCredentials): Promise<number> {
  return withRateLimit(`kucoin:${creds.apiKey}`, async () => {
    const data = await signedRequest("/api/v1/accounts", "GET", creds, { currency: "USDT", type: "trade" });
    const accounts: Array<{ currency: string; available: string }> = data ?? [];
    const usdt = accounts.find((a) => a.currency === "USDT");
    return usdt ? Number(Number(usdt.available).toFixed(2)) : 0;
  });
}

async function resolveOrderResult(creds: ExchangeCredentials, orderId: string): Promise<OrderResult> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const data = await signedRequest(`/api/v1/orders/${orderId}`, "GET", creds);
  const executedQty = Number(data?.dealSize ?? 0);
  const dealFunds = Number(data?.dealFunds ?? 0);
  const avgPrice = executedQty > 0 ? Number((dealFunds / executedQty).toFixed(8)) : null;
  return { orderId, executedQty, avgPrice };
}

async function placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult> {
  return withRateLimit(`kucoin:${creds.apiKey}`, async () => {
    const data = await signedRequest("/api/v1/orders", "POST", creds, {
      clientOid: crypto.randomUUID(),
      side: "buy",
      symbol: toSymbol(symbol),
      type: "market",
      funds: quoteAmount.toFixed(2), // sarflanadigan USDT miqdori
    });
    return resolveOrderResult(creds, data.orderId);
  });
}

async function placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult> {
  return withRateLimit(`kucoin:${creds.apiKey}`, async () => {
    const data = await signedRequest("/api/v1/orders", "POST", creds, {
      clientOid: crypto.randomUUID(),
      side: "sell",
      symbol: toSymbol(symbol),
      type: "market",
      size: baseQuantity.toString(), // sotiladigan asosiy aktiv miqdori
    });
    return resolveOrderResult(creds, data.orderId);
  });
}

export const kucoinAdapter: ExchangeAdapter = {
  id: "KuCoin",
  requiresPassphrase: true,
  toSymbol,
  fetchPrice,
  fetchQuoteBalance,
  placeMarketBuy,
  placeMarketSell,
};
