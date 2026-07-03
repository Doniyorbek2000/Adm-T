import crypto from "crypto";
import { Response } from "express";
import { z } from "zod";
import { PaymentMethod, PaymentStatus, PlanType } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { PLAN_LIMITS } from "../services/planLimits";
import { env } from "../utils/env";

/**
 * To'lov tizimi — uch rejimda ishlaydi (PAYMENT_MODE env orqali sozlanadi):
 *
 * 1) "click" — Click.uz to'lov tizimi (O'zbekiston). Foydalanuvchi to'lovni
 *    boshlaydi → biz PENDING to'lov yaratamiz → Click webhook tomonidan PAID
 *    ga o'tkaziladi.
 *
 * 2) "payme" — Payme.uz to'lov tizimi (O'zbekiston). Click'ga o'xshash oqim,
 *    faqat boshqa webhook formati va imzo tekshiruvi.
 *
 * 3) "test" (standart) — real provaydersiz ishlaydigan sinov rejimi. Tarif
 *    darhol faollashtiriladi (development/sinov uchun qulay). Production'ga
 *    chiqishda albatta "click" yoki "payme" ga o'tkazish kerak.
 */

const subscribeSchema = z.object({
  plan: z.nativeEnum(PlanType),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CLICK),
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

  const paymentId = crypto.randomUUID();
  const amountUsd = planConfig.priceMonthlyUsd;

  // Production (Click/Payme) da to'lov PENDING holatda yaratiladi va webhook
  // orqali tasdiqlanadi; sinov rejimida esa darhol PAID bo'ladi
  const isTestMode = env.paymentMode === "test";
  const initialStatus = isTestMode ? PaymentStatus.PAID : PaymentStatus.PENDING;

  const payment = await prisma.payment.create({
    data: {
      id: paymentId,
      userId: req.user!.id,
      plan: data.plan,
      amountUsd,
      status: initialStatus,
      method: data.method,
      periodStart: now,
      periodEnd,
    },
  });

  if (isTestMode) {
    // Sinov rejimi: darhol tarifni faollashtirish
    await activatePlan(req.user!.id, data.plan, periodEnd, planConfig.name);
    return res.status(201).json({
      payment,
      message: `"${planConfig.name}" tarifiga obuna muvaffaqiyatli amalga oshirildi`,
    });
  }

  // Click/Payme uchun to'lov ma'lumotlarini qaytarish (frontend redirect qiladi)
  const paymentInfo = buildPaymentInfo(env.paymentMode, paymentId, amountUsd, req.user!.id);

  res.status(201).json({
    payment,
    paymentInfo,
    message: `To'lovni amalga oshirish uchun quyidagi ma'lumotlardan foydalaning`,
  });
});

function buildPaymentInfo(mode: string, paymentId: string, amountUsd: number, userId: string) {
  // O'zbekiston so'miga taxminiy konvertatsiya (1 USD ≈ 12,500 UZS)
  const amountUzs = Math.round(amountUsd * 12_500);

  if (mode === "click") {
    return {
      provider: "Click",
      merchantId: env.clickMerchantId,
      serviceId: env.clickServiceId,
      transactionParam: paymentId,
      amount: amountUzs,
      returnUrl: `${env.corsOrigin}/dashboard/subscription?status=success`,
    };
  }

  // Payme
  const paymeData = Buffer.from(
    `m=${env.paymeMerchantId};ac.order_id=${paymentId};ac.user_id=${userId};a=${amountUzs * 100};c=${env.corsOrigin}/dashboard/subscription?status=success`
  ).toString("base64");

  return {
    provider: "Payme",
    checkoutUrl: `https://checkout.paycom.uz/${paymeData}`,
    transactionParam: paymentId,
    amount: amountUzs,
  };
}

/**
 * Click.uz webhook — Click serveridan keladi (POST).
 * Click ikkita bosqich yuboradi: Prepare (so'rov) va Complete (tasdiqlash).
 * Imzo tekshiriladi: md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
 */
export const clickWebhook = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const {
    click_trans_id,
    service_id,
    merchant_trans_id,
    amount,
    action,
    sign_time,
    sign_string,
    error: clickError,
  } = req.body;

  // Imzo tekshiruvi
  const expectedSign = crypto
    .createHash("md5")
    .update(`${click_trans_id}${service_id}${env.clickSecretKey}${merchant_trans_id}${amount}${action}${sign_time}`)
    .digest("hex");

  if (expectedSign !== sign_string) {
    return res.json({ error: -1, error_note: "Imzo noto'g'ri (SIGN CHECK FAILED)" });
  }

  const payment = await prisma.payment.findUnique({ where: { id: merchant_trans_id } });
  if (!payment) {
    return res.json({ error: -5, error_note: "To'lov topilmadi" });
  }

  if (payment.status === PaymentStatus.PAID) {
    return res.json({ error: 0, error_note: "Allaqachon to'langan" });
  }

  // action=0 — Prepare, action=1 — Complete
  if (Number(action) === 0) {
    return res.json({
      click_trans_id,
      merchant_trans_id,
      merchant_prepare_id: payment.id,
      error: 0,
      error_note: "Success",
    });
  }

  if (Number(clickError) !== 0) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
    return res.json({ error: -9, error_note: "To'lov rad etildi" });
  }

  // To'lov muvaffaqiyatli — tarifni faollashtirish
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });
  const planConfig = PLAN_LIMITS[payment.plan as PlanType];
  await activatePlan(payment.userId, payment.plan as PlanType, payment.periodEnd, planConfig?.name ?? payment.plan);

  res.json({
    click_trans_id,
    merchant_trans_id,
    merchant_confirm_id: payment.id,
    error: 0,
    error_note: "Success",
  });
});

/**
 * Payme.uz webhook — Payme serveridan keladi (POST, JSON-RPC formati).
 * Asosiy metodlar: CheckPerformTransaction, CreateTransaction,
 * PerformTransaction, CancelTransaction.
 */
export const paymeWebhook = asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Basic Auth tekshiruvi (Payme server o'z merchant kaliti bilan yuboradi)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    return res.status(401).json({ error: { code: -32504, message: { uz: "Avtorizatsiya talab qilinadi" } } });
  }
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const password = decoded.split(":").slice(1).join(":");
  if (!env.paymeKey || password !== env.paymeKey) {
    return res.status(401).json({ error: { code: -32504, message: { uz: "Avtorizatsiya xatosi" } } });
  }

  const { method, params, id: rpcId } = req.body;

  if (method === "CheckPerformTransaction") {
    const payment = await prisma.payment.findUnique({ where: { id: params?.account?.order_id } });
    if (!payment || payment.status === PaymentStatus.PAID) {
      return res.json({ error: { code: -31050, message: { uz: "Buyurtma topilmadi" } }, id: rpcId });
    }
    return res.json({ result: { allow: true }, id: rpcId });
  }

  if (method === "CreateTransaction") {
    const payment = await prisma.payment.findUnique({ where: { id: params?.account?.order_id } });
    if (!payment) {
      return res.json({ error: { code: -31050, message: { uz: "Buyurtma topilmadi" } }, id: rpcId });
    }
    return res.json({
      result: {
        create_time: Date.now(),
        transaction: payment.id,
        state: 1,
      },
      id: rpcId,
    });
  }

  if (method === "PerformTransaction") {
    const payment = await prisma.payment.findFirst({
      where: { id: params?.account?.order_id ?? params?.id },
    });
    if (!payment) {
      return res.json({ error: { code: -31050, message: { uz: "Tranzaksiya topilmadi" } }, id: rpcId });
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });
    const planConfig = PLAN_LIMITS[payment.plan as PlanType];
    await activatePlan(payment.userId, payment.plan as PlanType, payment.periodEnd, planConfig?.name ?? payment.plan);

    return res.json({
      result: { transaction: payment.id, perform_time: Date.now(), state: 2 },
      id: rpcId,
    });
  }

  if (method === "CancelTransaction") {
    const payment = await prisma.payment.findFirst({
      where: { id: params?.account?.order_id ?? params?.id },
    });
    if (payment && payment.status !== PaymentStatus.CANCELED) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CANCELED } });
      // Tarifni FREE ga tushirish
      await prisma.user.update({ where: { id: payment.userId }, data: { plan: PlanType.FREE, planExpiresAt: null } });
    }
    return res.json({
      result: { transaction: payment?.id, cancel_time: Date.now(), state: -1 },
      id: rpcId,
    });
  }

  res.json({ error: { code: -32601, message: { uz: "Metod topilmadi" } }, id: rpcId });
});

async function activatePlan(userId: string, plan: PlanType, periodEnd: Date, planName: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { plan, planExpiresAt: periodEnd },
  });

  await prisma.notification.create({
    data: {
      userId,
      title: "Tarif muvaffaqiyatli faollashtirildi",
      message: `"${planName}" tarifi 1 oy muddatga faollashtirildi. Endi yangi imkoniyatlardan foydalanishingiz mumkin!`,
    },
  });
}

export const myPayments = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ payments });
});
