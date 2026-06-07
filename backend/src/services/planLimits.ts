import { PlanType } from "../constants/enums";

export interface PlanLimit {
  type: PlanType;
  name: string;
  priceMonthlyUsd: number;
  description: string;
  features: string[];
  maxBrokerAccounts: number;
  autoTradeAllowed: boolean;
  signalDelayMin: number;
}

/**
 * Tarif rejalari - markazlashtirilgan konfiguratsiya.
 * Seed va biznes-logika (ruxsatlar tekshiruvi) shu yerdan foydalanadi.
 */
export const PLAN_LIMITS: Record<PlanType, PlanLimit> = {
  FREE: {
    type: PlanType.FREE,
    name: "Bepul",
    priceMonthlyUsd: 0,
    description: "Tizim bilan tanishish uchun boshlang'ich imkoniyatlar",
    features: [
      "Kuniga cheklangan AI signallari (60 daqiqa kechikish bilan)",
      "1 ta Demo (virtual) hisob",
      "Asosiy bozor tahlili sharhlari",
      "Email orqali bildirishnomalar",
    ],
    maxBrokerAccounts: 1,
    autoTradeAllowed: false,
    signalDelayMin: 60,
  },
  PRO: {
    type: PlanType.PRO,
    name: "Pro",
    priceMonthlyUsd: 29,
    description: "Faol treyderlar uchun kengaytirilgan signal va tahlillar",
    features: [
      "AI signallari 15 daqiqa kechikish bilan",
      "Kengaytirilgan AI tahlil va asoslash matnlari",
      "2 tagacha broker hisobini ulash (faqat signal rejimi)",
      "Kunlik bozor sharhi va statistikasi",
      "Ustuvor email/push bildirishnomalar",
    ],
    maxBrokerAccounts: 2,
    autoTradeAllowed: false,
    signalDelayMin: 15,
  },
  ULTRA: {
    type: PlanType.ULTRA,
    name: "Ultra",
    priceMonthlyUsd: 79,
    description: "AI’ga to'liq avtomatik savdoni ishonib topshiring",
    features: [
      "Barcha AI signallariga kechikishsiz (real vaqtda) kirish",
      "To'liq avtomatik savdo (AUTO_TRADE) - AI siz uchun savdo qiladi",
      "3 tagacha broker hisobi",
      "Tavakkal darajasini sozlash (past/o'rta/yuqori)",
      "Kengaytirilgan portfel va statistika paneli",
    ],
    maxBrokerAccounts: 3,
    autoTradeAllowed: true,
    signalDelayMin: 0,
  },
  VIP: {
    type: PlanType.VIP,
    name: "VIP",
    priceMonthlyUsd: 199,
    description: "Eksklyuziv signallar va shaxsiy AI sozlamalari bilan maksimal daraja",
    features: [
      "VIP-only eksklyuziv yuqori ishonchli signallar",
      "Cheksiz broker hisoblarini ulash va to'liq avto-treding",
      "Shaxsiylashtirilgan AI risk-profili",
      "24/7 ustuvor qo'llab-quvvatlash",
      "Oylik shaxsiy portfel hisobotlari",
    ],
    maxBrokerAccounts: 10,
    autoTradeAllowed: true,
    signalDelayMin: 0,
  },
};
