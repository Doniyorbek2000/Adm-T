import crypto from "crypto";
import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";
import { ExchangeAdapter, ExchangeApiError, ExchangeCredentials, OrderResult } from "./types";

/**
 * OKX REST integratsiyasi.
 *
 * OKX boshqa birjalardan farqli o'laroq alohida "demo trading" muhitiga ega
 * emas - shu sababli EXCHANGE_MODE="testnet" bo'lsa, biz haqiqiy production
 * URL'ga ulanamiz, lekin maxsus "x-simulated-trading: 1" sarlavhasi bilan -
 * bu OKX'ning rasmiy demo-savdo rejimi (sun'iy mablag', real natijaga ta'sir
 * qilmaydi). Bunday hisob OKX saytida alohida "Demo Trading" bo'limida
 * yaratiladi va alohida API kalitga ega bo'ladi.
 */

const BASE_URL = "https://www.okx.com";
const SIMULATED_HEADER = env.exchangeMode === "live" ? null : "1";

function toSymbol(symbol: string): string {
  return symbol.replace("/", "-").toUpperCase();
}

function sign(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

async function publicGet(path: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${path}?${query}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.code !== "0") {
    throw new ExchangeApiError(data?.msg ?? `OKX so'rovi muvaffaqiyatsiz tugadi (HTTP ${res.status})`, res.status, data?.code);
  }
  return data.data;
}

async function signedRequest(path: string, method: "GET" | "POST", creds: ExchangeCredentials, params: Record<string, unknown> = {}): Promise<any> {
  const timestamp = new Date().toISOString();
  let requestPath = path;
  let body = "";

  if (method === "GET") {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    requestPath = query ? `${path}?${query}` : path;
  } else {
    body = JSON.stringify(params);
  }

  const signature = sign(timestamp, method, requestPath, body, creds.apiSecret);
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": creds.apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": creds.passphrase ?? "",
    "Content-Type": "application/json",
  };
  if (SIMULATED_HEADER) headers["x-simulated-trading"] = SIMULATED_HEADER;

  const res = await fetch(`${BASE_URL}${requestPath}`, { method, headers, body: method === "POST" ? body : undefined });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.code !== "0") {
    const message =
      typeof data?.msg === "string" && data.msg
        ? data.msg
        : `OKX so'rovi rad etildi (HTTP ${res.status}). API kalit/maxfiy so'z/passphrase yoki ruxsatlarni tekshiring.`;
    throw new ExchangeApiError(message, res.status, data?.code);
  }
  return data.data;
}

async function fetchPrice(symbol: string): Promise<number> {
  return withRateLimit("okx:public", async () => {
    const data = await publicGet("/api/v5/market/ticker", { instId: toSymbol(symbol) });
    const price = Number(data?.[0]?.last);
    if (!Number.isFinite(price) || price <= 0) throw new ExchangeApiError("OKX noto'g'ri narx qaytardi", 502);
    return price;
  });
}

async function fetchQuoteBalance(creds: ExchangeCredentials): Promise<number> {
  return withRateLimit(`okx:${creds.apiKey}`, async () => {
    const data = await signedRequest("/api/v5/account/balance", "GET", creds, { ccy: "USDT" });
    const details: Array<{ ccy: string; availBal: string }> = data?.[0]?.details ?? [];
    const usdt = details.find((d) => d.ccy === "USDT");
    return usdt ? Number(Number(usdt.availBal).toFixed(2)) : 0;
  });
}

async function resolveOrderResult(creds: ExchangeCredentials, instId: string, orderId: string): Promise<OrderResult> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const data = await signedRequest("/api/v5/trade/order", "GET", creds, { instId, ordId: orderId });
  const order = data?.[0];
  const executedQty = Number(order?.accFillSz ?? 0);
  const avgPrice = order?.avgPx ? Number(order.avgPx) : null;
  return { orderId, executedQty, avgPrice };
}

async function placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult> {
  return withRateLimit(`okx:${creds.apiKey}`, async () => {
    const instId = toSymbol(symbol);
    const data = await signedRequest("/api/v5/trade/order", "POST", creds, {
      instId,
      tdMode: "cash",
      side: "buy",
      ordType: "market",
      tgtCcy: "quote_ccy", // sz - sarflanadigan USDT miqdori
      sz: quoteAmount.toFixed(2),
    });
    return resolveOrderResult(creds, instId, data?.[0]?.ordId);
  });
}

async function placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult> {
  return withRateLimit(`okx:${creds.apiKey}`, async () => {
    const instId = toSymbol(symbol);
    const data = await signedRequest("/api/v5/trade/order", "POST", creds, {
      instId,
      tdMode: "cash",
      side: "sell",
      ordType: "market",
      tgtCcy: "base_ccy", // sz - sotiladigan asosiy aktiv miqdori
      sz: baseQuantity.toString(),
    });
    return resolveOrderResult(creds, instId, data?.[0]?.ordId);
  });
}

export const okxAdapter: ExchangeAdapter = {
  id: "OKX",
  requiresPassphrase: true,
  toSymbol,
  fetchPrice,
  fetchQuoteBalance,
  placeMarketBuy,
  placeMarketSell,
};
