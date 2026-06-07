import { averageFillPrice, fetchSpotPrice, fetchUsdtBalance, placeMarketOrder } from "./binance";
import { bingxAdapter } from "./bingx";
import { bybitAdapter } from "./bybit";
import { kucoinAdapter } from "./kucoin";
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
 * Real (REST API orqali) integratsiya qilingan birjalar registri.
 *
 * MUHIM: MT5 bu yerda yo'q - chunki MetaTrader 5 boshqa birjalardan farqli
 * o'laroq ommaviy REST API'ga ega EMAS (u Windows-based terminal protokoli).
 * Haqiqiy MT5 integratsiyasi alohida "bridge" xizmati (masalan, MetaApi.cloud
 * kabi uchinchi tomon SaaS yoki maxsus Expert Advisor + WebSocket ko'prigi)
 * talab qiladi - bu alohida arxitektura qarori va qo'shimcha xarajat (obuna)
 * bilan bog'liq, shuning uchun hozircha signal-only/simulyatsiya rejimida
 * qoladi (qarang: aiEngine.ts izohlari).
 */
const REGISTRY: Record<string, ExchangeAdapter> = {
  Binance: binanceAdapter,
  Bybit: bybitAdapter,
  OKX: okxAdapter,
  KuCoin: kucoinAdapter,
  BingX: bingxAdapter,
};

export function getExchangeAdapter(exchange: string): ExchangeAdapter | null {
  return REGISTRY[exchange] ?? null;
}

export function isRealExchangeIntegrated(exchange: string): boolean {
  return exchange in REGISTRY;
}

export type { ExchangeAdapter, ExchangeCredentials, OrderResult };
export { ExchangeApiError } from "./types";
