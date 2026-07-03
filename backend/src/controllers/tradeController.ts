import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { fetchSpotPrice } from "../services/exchanges/binance";
import { getExchangeAdapter } from "../services/exchanges/registry";
import { decryptCredentials } from "../services/aiEngine";

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
  const userId = req.user!.id;

  const [accounts, openCount, closedCount, pnlAgg, winCount] = await Promise.all([
    prisma.brokerAccount.findMany({ where: { userId } }),
    prisma.trade.count({ where: { userId, status: "OPEN" } }),
    prisma.trade.count({ where: { userId, status: "CLOSED" } }),
    prisma.trade.aggregate({ where: { userId, status: "CLOSED" }, _sum: { pnlUsd: true } }),
    prisma.trade.count({ where: { userId, status: "CLOSED", pnlUsd: { gt: 0 } } }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balanceUsd, 0);
  const realizedPnl = pnlAgg._sum.pnlUsd ?? 0;
  const winRate = closedCount > 0 ? Number(((winCount / closedCount) * 100).toFixed(1)) : 0;

  res.json({
    totalBalance: Number(totalBalance.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
    openPositions: openCount,
    closedTrades: closedCount,
    winRate,
    accountsCount: accounts.length,
  });
});

/** Manually close an open trade — real exchange SELL or simulated market close */
export const closeTrade = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = req.params;

  const trade = await prisma.trade.findFirst({
    where: { id, userId: req.user!.id, status: "OPEN" },
    include: { brokerAccount: true },
  });

  if (!trade) {
    return res.status(404).json({ message: "Savdo topilmadi yoki allaqachon yopilgan" });
  }

  // Get current market price
  let exitPrice: number;
  try {
    exitPrice = await fetchSpotPrice(trade.symbol);
  } catch {
    exitPrice = trade.entryPrice; // fallback
  }

  const isReal =
    (trade.executionMode === "LIVE" || trade.executionMode === "TESTNET") &&
    trade.brokerAccount?.isConnected;

  if (isReal && trade.brokerAccount) {
    const adapter = getExchangeAdapter(trade.brokerAccount.exchange);
    if (adapter) {
      let creds;
      try {
        creds = decryptCredentials(trade.brokerAccount);
      } catch {
        return res.status(500).json({ message: "API kalitlarini o'qib bo'lmadi" });
      }

      try {
        const order = await adapter.placeMarketSell(creds, trade.symbol, trade.quantity);
        const realExit = order.avgPrice ?? exitPrice;
        const grossPnl = (realExit - trade.entryPrice) * trade.quantity;
        const feeUsd = realExit * trade.quantity * 0.002;
        const pnlUsd = Number((grossPnl - feeUsd).toFixed(2));

        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitPrice: realExit, pnlUsd, closedAt: new Date(), externalOrderId: order.orderId },
        });

        await prisma.notification.create({
          data: {
            userId: trade.userId,
            title: "Pozitsiya qo'lda yopildi",
            message: `${trade.symbol} savdosi qo'lda yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$ (komissiya hisobga olingan)`,
          },
        });

        return res.json({ success: true, exitPrice: realExit, pnlUsd });
      } catch (err) {
        return res.status(502).json({
          message: `Birjaga buyurtma yuborib bo'lmadi: ${err instanceof Error ? err.message : "Noma'lum xato"}`,
        });
      }
    }
  }

  // Simulated close at current price
  const pnlUsd = Number(((exitPrice - trade.entryPrice) * trade.quantity).toFixed(2));

  await prisma.trade.update({
    where: { id: trade.id },
    data: { status: "CLOSED", exitPrice, pnlUsd, closedAt: new Date() },
  });

  if (trade.brokerAccountId) {
    await prisma.brokerAccount.update({
      where: { id: trade.brokerAccountId },
      data: { balanceUsd: { increment: pnlUsd } },
    });
  }

  await prisma.notification.create({
    data: {
      userId: trade.userId,
      title: "Pozitsiya qo'lda yopildi",
      message: `${trade.symbol} savdosi qo'lda yopildi. Natija: ${pnlUsd >= 0 ? "+" : ""}${pnlUsd}$`,
    },
  });

  res.json({ success: true, exitPrice, pnlUsd });
});
