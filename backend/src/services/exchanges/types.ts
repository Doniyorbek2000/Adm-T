/**
 * Barcha kripto-birja klientlari uchun yagona interfeys.
 *
 * Bu orqali aiEngine va broker-account controlleri har bir birjaning ichki
 * autentifikatsiya/format farqlarini bilishi shart emas - faqat shu umumiy
 * shaklga murojaat qiladi. Yangi birja qo'shish uchun shu interfeysni
 * implement qiluvchi yangi klient yozish va registry.ts'ga ro'yxatdan
 * o'tkazish kifoya.
 */

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /** Faqat OKX/KuCoin kabi ba'zi birjalarda talab qilinadi */
  passphrase?: string;
}

export interface OrderResult {
  orderId: string;
  /** Haqiqatda bajarilgan asosiy aktiv miqdori (masalan, qancha BTC sotib olindi/sotildi) */
  executedQty: number;
  /** Buyurtmaning o'rtacha bajarilish narxi (agar birja qaytarmasa - null, signal narxi zaxira sifatida ishlatiladi) */
  avgPrice: number | null;
}

export interface ExchangeAdapter {
  /** BrokerAccount.exchange maydoniga mos keladigan nom */
  id: string;
  /** Ulanishda passphrase (maxfiy ibora) talab qilinadimi */
  requiresPassphrase: boolean;
  /** Ichki "BTC/USDT" formatini birjaga xos formatga o'giradi */
  toSymbol(symbol: string): string;
  /** Joriy bozor narxini olish (ommaviy, autentifikatsiyasiz) */
  fetchPrice(symbol: string): Promise<number>;
  /** Hisobning erkin USDT (asosiy savdo valyutasi) balansini olish */
  fetchQuoteBalance(creds: ExchangeCredentials): Promise<number>;
  /** Belgilangan summaga (USDT) teng miqdorda aktiv sotib olish (bozor buyurtmasi) */
  placeMarketBuy(creds: ExchangeCredentials, symbol: string, quoteAmount: number): Promise<OrderResult>;
  /** Belgilangan miqdordagi aktivni sotish (bozor buyurtmasi) - pozitsiyani yopish uchun */
  placeMarketSell(creds: ExchangeCredentials, symbol: string, baseQuantity: number): Promise<OrderResult>;
}

export class ExchangeApiError extends Error {
  readonly status: number;
  readonly providerCode?: string | number;

  constructor(message: string, status: number, providerCode?: string | number) {
    super(message);
    this.name = "ExchangeApiError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

export function toInternalSymbol(exchangeSymbol: string): string {
  return exchangeSymbol.replace("-", "/").toUpperCase();
}
