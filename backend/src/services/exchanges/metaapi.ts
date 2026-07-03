import { env } from "../../utils/env";
import { withRateLimit } from "./rateLimiter";
import { ExchangeAdapter, ExchangeApiError, ExchangeCredentials, OrderResult } from "./types";

/**
 * MT5 integratsiyasi MetaApi.cloud REST ko'prigi orqali.
 *
 * MetaTrader 5 o'zining ommaviy REST API'si YO'Q — u Windows-based terminal
 * protokoli. MetaApi.cloud bu muammoni hal qiladi: u MT5 terminali bilan
 * bog'lanadi va uning barcha funksiyalarini REST API orqali ochib beradi.
 *
 * Sozlash (bir marta):
 * 1) https://app.metaapi.cloud da ro'yxatdan o'ting (bepul tarif 1 hisobga ruxsat)
 * 2) API token yarating → METAAPI_TOKEN env ga qo'ying
 * 3) MT5 hisobingizni MetaApi'da "deploy" qiling (login, parol, server nomi)
 *    → paydo bo'lgan accountId ni broker ulash formida "API Secret" maydoniga kiriting
 *
 * Foydalanuvchi Credentials:
 *   apiKey    = METAAPI_TOKEN (env'dan olinadi, foydalanuvchi bu maydonga ixtiyoriy qiymat kiritishi mumkin)
 *   apiSecret = MetaApi accountId (MT5 hisobning MetaApi'dagi identifikatori)
 *   passphrase = ishlatilmaydi
 */

const TRADE_BASE = "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai";
const DATA_BASE = "https://mt-market-data-client-api-v1.agiliumtrade.agiliumtrade.ai";

function getToken(creds: ExchangeCredentials): string {
  return env.metaApiToken || creds.apiKey;
}

function getAccountId(creds: ExchangeCredentials): string {
  return creds.apiSecret;
}

function toSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

async function apiRequest(baseUrl: string, path: string, token: string, method: "GET" | "POST" = "GET", body?: object): Promise<any> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "auth-token": token,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data: any = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message ?? data?.error ?? `MetaApi so'rovi muvaffaqiyatsiz (HTTP ${res.status})`;
    throw new ExchangeApiError(
      typeof message === "string" ? message : JSON.stringify(message),
      res.status,
      data?.id
    );
  }

  return data;
}

async function fetchPrice(symbol: string): Promise<number> {
  return withRateLimit("metaapi:public", async () => {
    const token = env.metaApiToken;
    if (!token) throw new ExchangeApiError("METAAPI_TOKEN sozlanmagan", 500);

    // Ommaviy narx uchun birinchi topilgan aktiv MT5 hisobdan foydalanamiz
    // (MetaApi narx endpointi hisob kontekstida ishlaydi)
    throw new ExchangeApiError(
      "MT5 narx olish uchun hisob konteksti kerak — AI Engine Binance narxlaridan foydalanadi",
      501
    );
  });
}

async function fetchQuoteBalance(creds: ExchangeCredentials): Promise<number> {
  return withRateLimit(`metaapi:${getAccountId(creds)}`, async () => {
    const token = getToken(creds);
    const accountId = getAccountId(creds);

    const data = await apiRequest(
      TRADE_BASE,
      `/users/current/accounts/${accountId}/account-information`,
      token
    );

    const balance = Number(data?.balance);
    if (!Number.isFinite(balance)) throw new ExchangeApiError("MetaApi balans ma'lumoti noto'g'ri", 502);
    return Number(balance.toFixed(2));
  });
}

async function placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult> {
  return withRateLimit(`metaapi:${getAccountId(creds)}`, async () => {
    const token = getToken(creds);
    const accountId = getAccountId(creds);
    const sym = toSymbol(symbol);

    // MT5'da hajm "lot" da beriladi. Forex uchun 1 lot = 100,000 birlik.
    // Oddiy hisoblash: quoteAmount / 100,000, kamida 0.01 lot (mikro-lot).
    // Kripto/indeks juftliklari uchun boshqacha bo'lishi mumkin — MetaApi
    // symbolSpecification'dan contract size olish mumkin, ammo ko'p
    // holatlarda broker tomonidan avtomatik hisoblanadi.
    const volume = Math.max(0.01, Number((quoteAmount / 100_000).toFixed(2)));

    const data = await apiRequest(
      TRADE_BASE,
      `/users/current/accounts/${accountId}/trade`,
      token,
      "POST",
      {
        actionType: "ORDER_TYPE_BUY",
        symbol: sym,
        volume,
      }
    );

    const orderId = data?.orderId ?? data?.positionId ?? String(Date.now());
    const executedQty = volume;
    const avgPrice = Number(data?.openPrice) || null;

    return { orderId: String(orderId), executedQty, avgPrice };
  });
}

async function placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult> {
  return withRateLimit(`metaapi:${getAccountId(creds)}`, async () => {
    const token = getToken(creds);
    const accountId = getAccountId(creds);
    const sym = toSymbol(symbol);

    const volume = Math.max(0.01, Number(baseQuantity.toFixed(2)));

    const data = await apiRequest(
      TRADE_BASE,
      `/users/current/accounts/${accountId}/trade`,
      token,
      "POST",
      {
        actionType: "ORDER_TYPE_SELL",
        symbol: sym,
        volume,
      }
    );

    const orderId = data?.orderId ?? data?.positionId ?? String(Date.now());
    const avgPrice = Number(data?.openPrice) || null;

    return { orderId: String(orderId), executedQty: volume, avgPrice };
  });
}

export const metaapiAdapter: ExchangeAdapter = {
  id: "MT5",
  requiresPassphrase: false,
  toSymbol,
  fetchPrice,
  fetchQuoteBalance,
  placeMarketBuy,
  placeMarketSell,
};
