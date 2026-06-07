import { Response } from "express";
import { z } from "zod";
import { PlanType, Role, SignalStatus } from "../constants/enums";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { generateSignal } from "../services/aiEngine";

/* -------------------------------------------------------------------------- */
/* Dashboard statistikasi                                                      */
/* -------------------------------------------------------------------------- */

export const dashboardStats = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const [
    totalUsers,
    activeUsers,
    usersByPlan,
    totalSignals,
    activeSignals,
    totalTrades,
    openTrades,
    revenueAgg,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "USER", isActive: true } }),
    prisma.user.groupBy({ by: ["plan"], where: { role: "USER" }, _count: { _all: true } }),
    prisma.signal.count(),
    prisma.signal.count({ where: { status: "ACTIVE" } }),
    prisma.trade.count(),
    prisma.trade.count({ where: { status: "OPEN" } }),
    prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amountUsd: true } }),
    prisma.user.findMany({
      where: { role: "USER" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, fullName: true, email: true, plan: true, createdAt: true },
    }),
  ]);

  const planCounts: Record<string, number> = { FREE: 0, PRO: 0, ULTRA: 0, VIP: 0 };
  usersByPlan.forEach((row) => {
    planCounts[row.plan] = row._count._all;
  });

  res.json({
    totalUsers,
    activeUsers,
    blockedUsers: totalUsers - activeUsers,
    planCounts,
    totalSignals,
    activeSignals,
    totalTrades,
    openTrades,
    totalRevenueUsd: Number((revenueAgg._sum.amountUsd ?? 0).toFixed(2)),
    recentUsers,
  });
});

/* -------------------------------------------------------------------------- */
/* Foydalanuvchilarni boshqarish                                              */
/* -------------------------------------------------------------------------- */

export const listUsers = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const search = (req.query.search as string | undefined)?.trim();

  const users = await prisma.user.findMany({
    where: {
      role: "USER",
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      plan: true,
      planExpiresAt: true,
      isActive: true,
      createdAt: true,
      _count: { select: { brokerAccounts: true, trades: true } },
    },
  });

  res.json({ users });
});

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  plan: z.nativeEnum(PlanType).optional(),
  role: z.nativeEnum(Role).optional(),
});

export const updateUser = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = updateUserSchema.parse(req.body);
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw new AppError("Foydalanuvchi topilmadi", 404);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data,
  });

  if (data.isActive === false) {
    await prisma.notification.create({
      data: {
        userId: updated.id,
        title: "Hisobingiz bloklandi",
        message: "Administrator tomonidan hisobingiz vaqtincha bloklandi. Savollar uchun qo'llab-quvvatlash xizmatiga murojaat qiling.",
      },
    });
  }
  if (data.isActive === true) {
    await prisma.notification.create({
      data: { userId: updated.id, title: "Hisobingiz qayta faollashtirildi", message: "Endi tizimdan to'liq foydalanishingiz mumkin." },
    });
  }
  if (data.plan) {
    await prisma.notification.create({
      data: {
        userId: updated.id,
        title: "Tarifingiz administrator tomonidan o'zgartirildi",
        message: `Yangi tarifingiz: ${data.plan}`,
      },
    });
  }

  res.json({
    user: {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      plan: updated.plan,
      role: updated.role,
      isActive: updated.isActive,
    },
  });
});

/* -------------------------------------------------------------------------- */
/* Signallarni boshqarish (AI avtomatik yaratadi, admin qo'lda ham qo'sha oladi/yopa oladi) */
/* -------------------------------------------------------------------------- */

export const listAllSignals = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const signals = await prisma.signal.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ signals });
});

export const createManualSignal = asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Admin AI siklini kutmasdan, darhol yangi signal generatsiya qilishni so'rashi mumkin
  const signal = await generateSignal();
  res.status(201).json({ signal, message: "AI yangi signal generatsiya qildi" });
});

const closeSignalSchema = z.object({
  status: z.enum([SignalStatus.TP_HIT, SignalStatus.SL_HIT, SignalStatus.CLOSED]),
});

export const closeSignal = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = closeSignalSchema.parse(req.body);
  const signal = await prisma.signal.findUnique({ where: { id: req.params.id } });
  if (!signal) throw new AppError("Signal topilmadi", 404);

  const resultPnlPct =
    data.status === "TP_HIT"
      ? Math.abs((signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100
      : data.status === "SL_HIT"
      ? -Math.abs((signal.stopLoss - signal.entryPrice) / signal.entryPrice) * 100
      : 0;

  const updated = await prisma.signal.update({
    where: { id: signal.id },
    data: { status: data.status, resultPnlPct, closedAt: new Date() },
  });

  res.json({ signal: updated });
});

/* -------------------------------------------------------------------------- */
/* Tarif rejalarini boshqarish                                                */
/* -------------------------------------------------------------------------- */

export const listPlansAdmin = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: { priceMonthlyUsd: "asc" } });
  res.json({
    plans: plans.map((p) => ({ ...p, features: JSON.parse(p.featuresJson) as string[] })),
  });
});

const updatePlanSchema = z.object({
  priceMonthlyUsd: z.number().min(0).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  maxBrokerAccounts: z.number().int().min(1).optional(),
  autoTradeAllowed: z.boolean().optional(),
  signalDelayMin: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const updatePlan = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = updatePlanSchema.parse(req.body);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) throw new AppError("Tarif topilmadi", 404);

  const { features, ...rest } = data;

  const updated = await prisma.subscriptionPlan.update({
    where: { id: plan.id },
    data: {
      ...rest,
      ...(features ? { featuresJson: JSON.stringify(features) } : {}),
    },
  });

  res.json({ plan: { ...updated, features: JSON.parse(updated.featuresJson) as string[] } });
});

/* -------------------------------------------------------------------------- */
/* Savdolar nazorati                                                          */
/* -------------------------------------------------------------------------- */

export const listAllTrades = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const trades = await prisma.trade.findMany({
    orderBy: { openedAt: "desc" },
    take: 150,
    include: {
      user: { select: { fullName: true, email: true } },
      brokerAccount: { select: { exchange: true, label: true } },
    },
  });
  res.json({ trades });
});
