import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";

export const listPlans = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthlyUsd: "asc" },
  });

  res.json({
    plans: plans.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      priceMonthlyUsd: p.priceMonthlyUsd,
      description: p.description,
      features: JSON.parse(p.featuresJson) as string[],
      maxBrokerAccounts: p.maxBrokerAccounts,
      autoTradeAllowed: p.autoTradeAllowed,
      signalDelayMin: p.signalDelayMin,
    })),
  });
});
