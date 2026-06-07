import { Response } from "express";
import { z } from "zod";
import { PaymentMethod, PlanType } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { PLAN_LIMITS } from "../services/planLimits";

/**
 * Oylik obuna to'lovi.
 * Eslatma: bu yerda haqiqiy to'lov provayderi (Payme/Click/Stripe) integratsiyasi
 * o'rniga simulyatsiya qilingan "darhol muvaffaqiyatli to'lov" oqimi ishlatilgan -
 * production uchun shu joyga real to'lov shlyuzi ulanadi (webhook orqali
 * status PAID ga o'tkaziladi).
 */

const subscribeSchema = z.object({
  plan: z.nativeEnum(PlanType),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CLICK),
  cardNumber: z.string().trim().min(4).max(32).optional(),
  phoneNumber: z.string().trim().min(5).max(32).optional(),
});

export const subscribe = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = subscribeSchema.parse(req.body);

  if (data.plan === PlanType.FREE) {
    throw new AppError("Bepul tarifga o'tish uchun to'lov talab qilinmaydi", 400);
  }

  const planConfig = PLAN_LIMITS[data.plan];
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const payment = await prisma.payment.create({
    data: {
      userId: req.user!.id,
      plan: data.plan,
      amountUsd: planConfig.priceMonthlyUsd,
      status: "PAID", // simulyatsiya: darhol to'landi deb belgilanadi
      method: data.method,
      periodStart: now,
      periodEnd,
    },
  });

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { plan: data.plan, planExpiresAt: periodEnd },
  });

  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      title: "Tarif muvaffaqiyatli faollashtirildi",
      message: `"${planConfig.name}" tarifi 1 oy muddatga faollashtirildi. Endi yangi imkoniyatlardan foydalanishingiz mumkin!`,
    },
  });

  res.status(201).json({ payment, message: `"${planConfig.name}" tarifiga obuna muvaffaqiyatli amalga oshirildi` });
});

export const myPayments = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ payments });
});
