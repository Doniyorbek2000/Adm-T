import { averageFillPrice, fetchSpotPrice, fetchUsdtBalance, placeMarketOrder } from "./binance";
import { bingxAdapter } from "./bingx";
import { bybitAdapter } from "./bybit";
import { kucoinAdapter } from "./kucoin";
import { metaapiAdapter } from "./metaapi";
import { okxAdapter } from "./okx";
import { ExchangeAdapter, ExchangeCredentials, OrderResult } from "./types";

/** Binance klienti boshqa funksiya nomlari bilan yozilgan - uni umumiy interfeysga moslaymiz */
const binanceAdapter: ExchangeAdapter = {
  id: "Binance",
  requiresPassphrase: false,
  toSymbol: (symbol) => symbol.replace("/", "").toUpperCase(),
  fetchPrice: (symbol) => fetchSpotPrice(symbol),
  fetchQuoteBalance: (creds) => fetchUsdtBalance(creds.apiKey, creds.apiSecret),
  placeMarketBuy: async (creds, symbol, quoteAmount): Promise<OrderResult> => {
    const order = await placeMarketOrder({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, symbol, side: "BUY", quoteOrderQty: quoteAmount });
    return { orderId: String(order.orderId), executedQty: Number(order.executedQty), avgPrice: averageFillPrice(order.fills) };
  },
  placeMarketSell: async (creds, symbol, baseQuantity): Promise<OrderResult> => {
    const order = await placeMarketOrder({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, symbol, side: "SELL", quantity: baseQuantity });
    return { orderId: String(order.orderId), executedQty: Number(order.executedQty), avgPrice: averageFillPrice(order.fills) };
  },
};

/**
 * Barcha integratsiya qilingan birjalar registri:
 * - Binance, Bybit, OKX, KuCoin, BingX — to'g'ridan-to'g'ri REST API
 * - MT5 — MetaApi.cloud REST ko'prigi orqali (METAAPI_TOKEN env kerak)
 */
const REGISTRY: Record<string, ExchangeAdapter> = {
  Binance: binanceAdapter,
  Bybit: bybitAdapter,
  OKX: okxAdapter,
  KuCoin: kucoinAdapter,
  BingX: bingxAdapter,
  MT5: metaapiAdapter,
};

export function getExchangeAdapter(exchange: string): ExchangeAdapter | null {
  return REGISTRY[exchange] ?? null;
}

export function isRealExchangeIntegrated(exchange: string): boolean {
  return exchange in REGISTRY;
}

export type { ExchangeAdapter, ExchangeCredentials, OrderResult };
export { ExchangeApiError } from "./types";
