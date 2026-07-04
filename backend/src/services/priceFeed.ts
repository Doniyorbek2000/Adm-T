import { fetchSpotPrice } from "./exchanges/binance";

/**
 * Real vaqtdagi narx oqimi — Binance WebSocket (miniTicker) orqali.
 *
 * Nima uchun: REST polling bilan TP/SL tekshiruvi 60 soniyada bir marta
 * bo'lardi — narx bu oynada TP'dan sakrab o'tib qaytishi mumkin edi.
 * WebSocket bilan narxlar soniyasiga yangilanadi va tezkor himoya sikli
 * (fast guard) har 10 soniyada himoyasiz pozitsiyalarni tekshiradi.
 *
 * Ishonchlilik:
 *  - Uzilishda eksponensial backoff bilan avtomatik qayta ulanish
 *  - Kesh eskirgan bo'lsa (>30s) getPrice() avtomatik REST'ga qaytadi —
 *    WebSocket ishlamasa ham tizim to'xtamaydi, faqat sekinlashadi
 *  - Node 21+ da o'rnatilgan global WebSocket ishlatiladi (qo'shimcha
 *    kutubxona kerak emas)
 */

const WS_BASE = "wss://stream.binance.com:9443";
const PRICE_FRESH_MS = 30_000;

interface CachedPrice {
  price: number;
  updatedAt: number;
}

const priceCache = new Map<string, CachedPrice>();

let ws: WebSocket | null = null;
let watchedSymbols: string[] = [];
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopped = true;

function toStreamName(symbol: string): string {
  return `${symbol.replace("/", "").toLowerCase()}@miniTicker`;
}

function toInternalSymbol(streamSymbol: string): string {
  // "BTCUSDT" -> "BTC/USDT" (kuzatilayotgan ro'yxatdan qidiramiz)
  const compact = streamSymbol.toUpperCase();
  return watchedSymbols.find((s) => s.replace("/", "") === compact) ?? compact;
}

function connect() {
  if (stopped || watchedSymbols.length === 0) return;

  const streams = watchedSymbols.map(toStreamName).join("/");
  const url = `${WS_BASE}/stream?streams=${streams}`;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("[PriceFeed] WebSocket ochishda xato:", err instanceof Error ? err.message : err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectAttempt = 0;
    console.log(`[PriceFeed] WebSocket ulandi (${watchedSymbols.length} juftlik, real vaqtda narx)`);
  };

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
      const data = parsed?.data;
      // miniTicker: { s: "BTCUSDT", c: "45123.45", ... }
      if (data?.s && data?.c) {
        const price = Number(data.c);
        if (Number.isFinite(price) && price > 0) {
          priceCache.set(toInternalSymbol(data.s), { price, updatedAt: Date.now() });
        }
      }
    } catch {
      // noto'g'ri xabar — e'tiborsiz
    }
  };

  ws.onclose = () => {
    if (!stopped) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose baribir chaqiriladi — u yerda qayta ulanamiz
  };
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(60_000, 1000 * 2 ** Math.min(reconnectAttempt, 6));
  reconnectAttempt++;
  console.warn(`[PriceFeed] WebSocket uzildi — ${Math.round(delay / 1000)}s dan keyin qayta ulanish (urinish ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/** Narx oqimini ishga tushirish (server startida bir marta) */
export function startPriceFeed(symbols: string[]) {
  watchedSymbols = [...symbols];
  stopped = false;
  if (typeof WebSocket === "undefined") {
    console.warn("[PriceFeed] Global WebSocket mavjud emas (Node <21) — REST polling rejimida ishlanadi");
    return;
  }
  connect();
}

export function stopPriceFeed() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
    // yopishda xato — muhim emas
  }
  ws = null;
}

/** Keshdan yangi (30s ichidagi) narx; yo'q bo'lsa null */
export function getCachedPrice(symbol: string): number | null {
  const cached = priceCache.get(symbol);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > PRICE_FRESH_MS) return null;
  return cached.price;
}

/**
 * Narx olish: avval WebSocket keshi (millisekundlik yangilik), eskirgan
 * bo'lsa REST fallback. Savdo mantiqining yagona narx manbai.
 */
export async function getPrice(symbol: string): Promise<number> {
  const cached = getCachedPrice(symbol);
  if (cached !== null) return cached;
  const price = await fetchSpotPrice(symbol);
  priceCache.set(symbol, { price, updatedAt: Date.now() });
  return price;
}

/** Test/diagnostika uchun: keshga narx qo'yish */
export function __setCachedPrice(symbol: string, price: number, updatedAt = Date.now()) {
  priceCache.set(symbol, { price, updatedAt });
}
