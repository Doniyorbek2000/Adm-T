/**
 * SQLite Prisma enumlarni qo'llab-quvvatlamagani uchun bu "enum"-simon
 * konstantalar butun backend bo'ylab String maydonlar uchun yagona
 * haqiqat manbai (single source of truth) sifatida ishlatiladi.
 */

export const Role = { USER: "USER", ADMIN: "ADMIN" } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PlanType = { FREE: "FREE", PRO: "PRO", ULTRA: "ULTRA", VIP: "VIP" } as const;
export type PlanType = (typeof PlanType)[keyof typeof PlanType];

export const SignalDirection = { BUY: "BUY", SELL: "SELL" } as const;
export type SignalDirection = (typeof SignalDirection)[keyof typeof SignalDirection];

export const SignalStatus = {
  ACTIVE: "ACTIVE",
  TP_HIT: "TP_HIT",
  SL_HIT: "SL_HIT",
  CLOSED: "CLOSED",
  /** 48 soat ichida TP/SL ga yetmagan — joriy narxda majburiy yopilgan (win-rate statistikasini buzmaslik uchun alohida) */
  EXPIRED: "EXPIRED",
} as const;
export type SignalStatus = (typeof SignalStatus)[keyof typeof SignalStatus];

export const TradeMode = { SIGNAL_ONLY: "SIGNAL_ONLY", AUTO_TRADE: "AUTO_TRADE" } as const;
export type TradeMode = (typeof TradeMode)[keyof typeof TradeMode];

export const TradeStatus = { OPEN: "OPEN", CLOSED: "CLOSED" } as const;
export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

export const PaymentStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const SenderRole = { USER: "USER", ADMIN: "ADMIN" } as const;
export type SenderRole = (typeof SenderRole)[keyof typeof SenderRole];

export const PaymentMethod = {
  HUMO: "HUMO",
  UZCARD: "UZCARD",
  VISA: "VISA",
  MASTERCARD: "MASTERCARD",
  CLICK: "CLICK",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PLAN_ORDER: PlanType[] = [PlanType.FREE, PlanType.PRO, PlanType.ULTRA, PlanType.VIP];
