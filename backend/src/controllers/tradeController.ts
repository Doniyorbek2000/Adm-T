import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";

export const listMyTrades = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const trades = await prisma.trade.findMany({
    where: { userId: req.user!.id },
    orderBy: { openedAt: "desc" },
    take: 200,
    include: {
      brokerAccount: { select: { exchange: true, label: true } },
      signal: { select: { confidence: true, analysis: true } },
    },
  });
  res.json({ trades });
});

export const myPortfolioSummary = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const [accounts, openTrades, closedTrades] = await Promise.all([
    prisma.brokerAccount.findMany({ where: { userId: req.user!.id } }),
    prisma.trade.findMany({ where: { userId: req.user!.id, status: "OPEN" } }),
    prisma.trade.findMany({ where: { userId: req.user!.id, status: "CLOSED" } }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balanceUsd, 0);
  const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
  const winCount = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? Number(((winCount / closedTrades.length) * 100).toFixed(1)) : 0;

  res.json({
    totalBalance: Number(totalBalance.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
    openPositions: openTrades.length,
    closedTrades: closedTrades.length,
    winRate,
    accountsCount: accounts.length,
  });
});
