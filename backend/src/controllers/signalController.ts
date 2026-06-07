import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { PLAN_LIMITS } from "../services/planLimits";
import { PLAN_ORDER } from "../constants/enums";

/**
 * Signal ko'rsatish logikasi:
 *  - Har bir signalda "minPlan" bor (qaysi tarif uni birinchi bo'lib ko'ra oladi).
 *  - Har bir tarifda "signalDelayMin" bor - past tarifdagi foydalanuvchi signalni
 *    pastroq ishonch darajasidagilarni darhol, lekin minPlan dan yuqori signallarni
 *    faqat belgilangan kechikishdan so'ng ko'radi (masalan FREE - 60 daqiqa, VIP - 0).
 *  - Bu orqali yuqori tariflar "tezroq va eksklyuziv" signallarga ega bo'ladi,
 *    quyi tariflar esa baribir tizimning qiymatini ko'rib, tarifni oshirishga undaladi.
 */

function planRank(plan: keyof typeof PLAN_LIMITS) {
  return PLAN_ORDER.indexOf(plan);
}

export const listSignals = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userPlan = req.user!.plan;
  const myDelayMin = PLAN_LIMITS[userPlan].signalDelayMin;

  const signals = await prisma.signal.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const now = Date.now();

  const visible = signals
    .map((s) => {
      const requiredDelayMs = myDelayMin * 60 * 1000;
      const availableAt = new Date(s.createdAt.getTime() + requiredDelayMs);
      const isLocked = now < availableAt.getTime();

      if (isLocked) {
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
