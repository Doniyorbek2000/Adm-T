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

/**
 * Ommaviy BOZOR MA'LUMOTLARI uchun so'rov — savdo muhitidan (testnet/live)
 * qat'i nazar HAQIQIY bozor narxlari ishlatiladi: testnet order-book yupqa
 * va noaniq, tahlil esa real bozorga asoslanishi kerak. Geo-blok holatida
 * BINANCE_PUBLIC_API env bilan data-api.binance.vision'ga o'tkaziladi.
 */
async function publicDataGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `${env.binancePublicApiBase}${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url);
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BinanceApiError(data?.msg ?? `Binance ma'lumot so'rovi muvaffaqiyatsiz (HTTP ${res.status})`, res.status, data?.code);
  }
  return data;
}

function buildQuery(params: Record<string, string | number>): string {
  const entries = Object.entries(params).map(([key, value]) => [key, String(value)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

async function signedRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
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

/**
 * Bid-ask spread (foizda). Keng spread = past likvidlik — market buyurtma
 * yomon narxda to'ldiriladi, bunday paytda kirishni o'tkazib yuborgan ma'qul.
 * null — olinmadi (bu holda kirish bloklanmaydi).
 */
export async function fetchSpreadPct(symbol: string): Promise<number | null> {
  try {
    return await withRateLimit("binance:public", async () => {
      const data = await publicDataGet("/api/v3/ticker/bookTicker", { symbol: toBinanceSymbol(symbol) });
      const bid = Number(data?.bidPrice);
      const ask = Number(data?.askPrice);
      if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
      return Number((((ask - bid) / ((ask + bid) / 2)) * 100).toFixed(4));
    });
  } catch {
    return null;
  }
}

/** Kirishdan oldin ruxsat etilgan maksimal spread (%) */
export const MAX_ENTRY_SPREAD_PCT = 0.5;

/** Joriy bozor narxini Binance'ning ommaviy (autentifikatsiyasiz) endpointidan olish */
export async function fetchSpotPrice(symbol: string): Promise<number> {
  return withRateLimit("binance:public", async () => {
    const data = await publicDataGet("/api/v3/ticker/price", { symbol: toBinanceSymbol(symbol) });
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
    // Only count free (unlocked) balance — locked is already committed to open orders
    return Number(Number(usdt.free).toFixed(2));
  });
}

export interface ApiKeyRestrictions {
  withdrawalsEnabled: boolean;
  spotTradingEnabled: boolean;
  futuresEnabled: boolean;
}

/**
 * API kalit ruxsatlarini tekshirish (faqat live rejimda mavjud — testnet'da
 * sapi endpointlari yo'q). Pul yechish (withdrawal) yoqilgan kalit trading
 * botiga ULANMASLIGI kerak: bot buzilsa ham mablag' yechib bo'lmasin.
 * null — tekshirib bo'lmadi (endpoint mavjud emas), bloklamaymiz.
 */
export async function fetchApiKeyRestrictions(apiKey: string, apiSecret: string): Promise<ApiKeyRestrictions | null> {
  if (env.exchangeMode !== "live") return null;
  try {
    const data = await withRateLimit(`binance:${apiKey}`, () =>
      signedRequest("/sapi/v1/account/apiRestrictions", "GET", apiKey, apiSecret)
    );
    return {
      withdrawalsEnabled: !!data?.enableWithdrawals,
      spotTradingEnabled: !!data?.enableSpotAndMarginTrading,
      futuresEnabled: !!data?.enableFutures,
    };
  } catch (err) {
    console.warn("[Binance] API kalit ruxsatlarini tekshirib bo'lmadi:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface BinanceOrderFill {
  price: string;
  qty: string;
  commission?: string;
  commissionAsset?: string;
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Himoya (OCO) buyurtmalari — TP va SL birjaning O'ZIDA turadi, shu sababli
 * server o'chib qolsa ham pozitsiya himoyasiz qolmaydi.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SymbolFilters {
  tickSize: number; // narx qadami (PRICE_FILTER)
  stepSize: number; // miqdor qadami (LOT_SIZE)
  minNotional: number; // minimal buyurtma qiymati (USDT)
}

const filtersCache = new Map<string, { filters: SymbolFilters; fetchedAt: number }>();
const FILTERS_TTL_MS = 12 * 60 * 60 * 1000;

/** Binance exchangeInfo'dan simvolning narx/miqdor qadamlarini olish (keshlangan) */
export async function getSymbolFilters(symbol: string): Promise<SymbolFilters> {
  const binanceSymbol = toBinanceSymbol(symbol);
  const cached = filtersCache.get(binanceSymbol);
  if (cached && Date.now() - cached.fetchedAt < FILTERS_TTL_MS) return cached.filters;

  const data = await withRateLimit("binance:public", () =>
    publicGet("/api/v3/exchangeInfo", { symbol: binanceSymbol })
  );
  const info = data?.symbols?.[0];
  if (!info) throw new BinanceApiError(`${symbol} uchun exchangeInfo topilmadi`, 502);

  const priceFilter = info.filters?.find((f: any) => f.filterType === "PRICE_FILTER");
  const lotFilter = info.filters?.find((f: any) => f.filterType === "LOT_SIZE");
  const notionalFilter = info.filters?.find((f: any) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");

  const filters: SymbolFilters = {
    tickSize: Number(priceFilter?.tickSize) || 0.00000001,
    stepSize: Number(lotFilter?.stepSize) || 0.00000001,
    minNotional: Number(notionalFilter?.minNotional) || 5,
  };
  filtersCache.set(binanceSymbol, { filters, fetchedAt: Date.now() });
  return filters;
}

/**
 * Qiymatni berilgan qadamga PASTGA yaxlitlash (floating-point xatolarisiz).
 * Binance qadam talabiga mos kelmagan narx/miqdorni rad etadi.
 */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  // Kichik epsilon nisbatga qo'shiladi — 2.675/0.001 = 2674.9999... kabi
  // floating-point xatolari noto'g'ri pastga yaxlitlanib ketmasligi uchun
  const floored = Math.floor(value / step + 1e-9) * step;
  return Number(floored.toFixed(precision));
}

/**
 * Market BUY'dan keyin real sotish mumkin bo'lgan miqdor: bajarilgan miqdordan
 * asosiy aktivda ushlab qolingan komissiya ayiriladi (aks holda OCO SELL
 * "insufficient balance" bilan rad etiladi).
 */
export function sellableQuantity(executedQty: number, fills: BinanceOrderFill[] | undefined, baseAsset: string): number {
  if (!fills) return executedQty;
  const baseCommission = fills.reduce((sum, f) => {
    if (f.commissionAsset === baseAsset) return sum + (Number(f.commission) || 0);
    return sum;
  }, 0);
  return Math.max(0, executedQty - baseCommission);
}

export interface OcoPlacementResult {
  orderListId: string;
  quantity: number;
}

/**
 * Ochiq BUY pozitsiyasini himoyalash uchun OCO SELL joylashtiradi:
 * TP — limit buyurtma, SL — stop-limit buyurtma. Bittasi bajarilsa,
 * ikkinchisi avtomatik bekor bo'ladi (birja tomonida).
 */
export async function placeOcoSell(params: {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  quantity: number;
  takeProfit: number;
  stopLoss: number;
}): Promise<OcoPlacementResult> {
  const filters = await getSymbolFilters(params.symbol);

  const qty = floorToStep(params.quantity, filters.stepSize);
  const tpPrice = floorToStep(params.takeProfit, filters.tickSize);
  const slTrigger = floorToStep(params.stopLoss, filters.tickSize);
  // Stop-limit narxi triggerdan biroz pastroq — tez tushishda ham bajarilishi uchun
  const slLimit = floorToStep(params.stopLoss * 0.995, filters.tickSize);

  if (qty <= 0 || qty * slLimit < filters.minNotional) {
    throw new BinanceApiError(
      `OCO uchun miqdor juda kichik (${qty} × ${slLimit} < minNotional ${filters.minNotional})`,
      400
    );
  }

  const data = await withRateLimit(`binance:${params.apiKey}`, () =>
    signedRequest("/api/v3/order/oco", "POST", params.apiKey, params.apiSecret, {
      symbol: toBinanceSymbol(params.symbol),
      side: "SELL",
      quantity: qty,
      price: tpPrice,
      stopPrice: slTrigger,
      stopLimitPrice: slLimit,
      stopLimitTimeInForce: "GTC",
    })
  );

  if (data?.orderListId === undefined) {
    throw new BinanceApiError("Binance OCO javobida orderListId yo'q", 502);
  }
  return { orderListId: String(data.orderListId), quantity: qty };
}

export interface OcoStatusResult {
  /** OPEN — hali kutmoqda; FILLED — TP yoki SL bajarildi; CANCELED — bekor qilingan */
  status: "OPEN" | "FILLED" | "CANCELED";
  exitPrice: number | null;
  executedQty: number;
}

/** OCO ro'yxati holatini tekshiradi; bajarilgan bo'lsa, real chiqish narxini qaytaradi */
export async function fetchOcoStatus(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderListId: string
): Promise<OcoStatusResult> {
  const list = await withRateLimit(`binance:${apiKey}`, () =>
    signedRequest("/api/v3/orderList", "GET", apiKey, apiSecret, { orderListId })
  );

  const listStatus: string = list?.listOrderStatus ?? "EXECUTING";
  if (listStatus === "EXECUTING") return { status: "OPEN", exitPrice: null, executedQty: 0 };

  // ALL_DONE — qaysi oyoq (TP yoki SL) bajarilganini buyurtmalardan aniqlaymiz
  const orders: Array<{ orderId: number }> = list?.orders ?? [];
  const binanceSymbol = toBinanceSymbol(symbol);

  for (const o of orders) {
    const order = await withRateLimit(`binance:${apiKey}`, () =>
      signedRequest("/api/v3/order", "GET", apiKey, apiSecret, { symbol: binanceSymbol, orderId: o.orderId })
    );
    const executedQty = Number(order?.executedQty) || 0;
    if (order?.status === "FILLED" && executedQty > 0) {
      const quote = Number(order?.cummulativeQuoteQty) || 0;
      const exitPrice = quote > 0 ? Number((quote / executedQty).toFixed(8)) : Number(order?.price) || null;
      return { status: "FILLED", exitPrice, executedQty };
    }
  }

  // Hech bir oyoq to'ldirilmagan, lekin ro'yxat yakunlangan — bekor qilingan
  return { status: "CANCELED", exitPrice: null, executedQty: 0 };
}

/**
 * OCO'ni bekor qiladi (masalan, pozitsiyani qo'lda yopishdan oldin).
 * "already_done" — OCO allaqachon bajarilgan/yakunlangan (bekor qilib bo'lmaydi).
 */
export async function cancelOcoOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  orderListId: string
): Promise<"canceled" | "already_done"> {
  try {
    await withRateLimit(`binance:${apiKey}`, () =>
      signedRequest("/api/v3/orderList", "DELETE", apiKey, apiSecret, {
        symbol: toBinanceSymbol(symbol),
        orderListId,
      })
    );
    return "canceled";
  } catch (err) {
    if (err instanceof BinanceApiError && (err.code === -2011 || err.status === 400)) {
      // -2011: Unknown order sent — allaqachon bajarilgan yoki bekor qilingan
      return "already_done";
    }
    throw err;
  }
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
