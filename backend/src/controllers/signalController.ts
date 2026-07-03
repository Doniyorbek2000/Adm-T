import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { PLAN_LIMITS } from "../services/planLimits";
import { PLAN_ORDER, PlanType } from "../constants/enums";

// Returns numeric rank of a plan (FREE=0, PRO=1, ULTRA=2, VIP=3)
function planRank(plan: string): number {
  return PLAN_ORDER.indexOf(plan as PlanType);
}

export const listSignals = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userPlan = req.user!.plan;
  const userRank = planRank(userPlan);
  const myDelayMin = PLAN_LIMITS[userPlan].signalDelayMin;

  const signals = await prisma.signal.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const now = Date.now();

  const visible = signals.map((s) => {
    const signalMinRank = planRank(s.minPlan ?? "FREE");

    // Signal foydalanuvchi tarifidan yuqori darajani talab qilsa — yopiq ko'rsatish
    if (signalMinRank > userRank) {
      return {
        id: s.id,
        symbol: s.symbol,
        direction: null,
        entryPrice: null,
        takeProfit: null,
        stopLoss: null,
        confidence: s.confidence,
        analysis: null,
        minPlan: s.minPlan,
        status: s.status,
        createdAt: s.createdAt,
        locked: true,
        lockedReason: `Bu signal faqat ${s.minPlan} tarif va undan yuqori foydalanuvchilar uchun. Tarifni yangilang.`,
      };
    }

    // Vaqt kechikishini tekshirish (tarif bo'yicha)
    const requiredDelayMs = myDelayMin * 60 * 1000;
    const availableAt = new Date(s.createdAt.getTime() + requiredDelayMs);
    const isTimeLocked = now < availableAt.getTime();

    if (isTimeLocked) {
      return {
        id: s.id,
        symbol: s.symbol,
        direction: null,
        entryPrice: null,
        takeProfit: null,
        stopLoss: null,
        confidence: s.confidence,
        analysis: null,
        minPlan: s.minPlan,
        status: s.status,
        createdAt: s.createdAt,
        locked: true,
        unlocksAt: availableAt,
        lockedReason: `Bu signal sizning tarifingizda ${myDelayMin} daqiqalik kechikish bilan ochiladi. Tezroq kirish uchun tarifni yangilang.`,
      };
    }

    return {
      id: s.id,
      symbol: s.symbol,
      direction: s.direction,
      entryPrice: s.entryPrice,
      takeProfit: s.takeProfit,
      stopLoss: s.stopLoss,
      confidence: s.confidence,
      analysis: s.analysis,
      minPlan: s.minPlan,
      status: s.status,
      resultPnlPct: s.resultPnlPct,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      locked: false,
    };
  });

  res.json({ signals: visible });
});

export const signalStats = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const [total, active, closed, wins] = await Promise.all([
    prisma.signal.count(),
    prisma.signal.count({ where: { status: "ACTIVE" } }),
    prisma.signal.count({ where: { status: { in: ["TP_HIT", "SL_HIT"] } } }),
    prisma.signal.count({ where: { status: "TP_HIT" } }),
  ]);

  const winRate = closed > 0 ? Number(((wins / closed) * 100).toFixed(1)) : 0;

  res.json({ total, active, closed, wins, winRate });
});
