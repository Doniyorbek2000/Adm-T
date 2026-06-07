import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PLAN_LIMITS } from "../services/planLimits";
import { env } from "../utils/env";
import { generateSignal } from "../services/aiEngine";

const prisma = new PrismaClient();

async function main() {
  console.log("Tarif rejalarini yuklash...");
  for (const plan of Object.values(PLAN_LIMITS)) {
    await prisma.subscriptionPlan.upsert({
      where: { type: plan.type },
      update: {
        name: plan.name,
        priceMonthlyUsd: plan.priceMonthlyUsd,
        description: plan.description,
        featuresJson: JSON.stringify(plan.features),
        maxBrokerAccounts: plan.maxBrokerAccounts,
        autoTradeAllowed: plan.autoTradeAllowed,
        signalDelayMin: plan.signalDelayMin,
      },
      create: {
        type: plan.type,
        name: plan.name,
        priceMonthlyUsd: plan.priceMonthlyUsd,
        description: plan.description,
        featuresJson: JSON.stringify(plan.features),
        maxBrokerAccounts: plan.maxBrokerAccounts,
        autoTradeAllowed: plan.autoTradeAllowed,
        signalDelayMin: plan.signalDelayMin,
      },
    });
  }

  console.log("Administrator hisobini yaratish...");
  const adminPasswordHash = await bcrypt.hash(env.adminPassword, 10);
  await prisma.user.upsert({
    where: { email: env.adminEmail.toLowerCase() },
    update: {},
    create: {
      fullName: "ADM Trading Administrator",
      email: env.adminEmail.toLowerCase(),
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      plan: "VIP",
    },
  });
  console.log(`Admin login: ${env.adminEmail} / ${env.adminPassword}`);

  const signalCount = await prisma.signal.count();
  if (signalCount === 0) {
    console.log("Boshlang'ich AI signallari generatsiya qilinmoqda...");
    for (let i = 0; i < 8; i++) {
      await generateSignal();
    }
  }

  console.log("Seed muvaffaqiyatli yakunlandi.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
