import { app } from "./app";
import { env } from "./utils/env";
import { startAiEngine, stopAiEngine } from "./services/aiEngine";
import { prisma } from "./utils/prisma";

async function main() {
  // SQLite WAL rejimi: yozish paytida o'qishlar bloklanmaydi — bitta server
  // jarayoni uchun ishonchli va tez (shaxsiy foydalanish uchun yetarli)
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch {
    // PostgreSQL yoki boshqa DB bo'lsa PRAGMA ishlamaydi — muammo emas
  }

  const server = app.listen(env.port, () => {
    console.log(`ADM Trading API http://localhost:${env.port} portida ishga tushdi`);
    // AI tahlil/savdo dvigateli serverga ulanishi bilan fonda mustaqil ishga tushadi
    startAiEngine(60_000);
  });

  // Graceful shutdown: yangi savdo boshlanmasin, ulanishlar yopilsin.
  // Ochiq pozitsiyalar birja tomonidagi TP/SL bilan himoyalangan — server
  // o'chsa ham xavfsiz.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} qabul qilindi — server to'xtatilmoqda (ochiq pozitsiyalar birja TP/SL bilan himoyalangan)...`);

    stopAiEngine();
    server.close(async () => {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    });

    // 10 soniyada yopilmasa majburiy chiqish
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Serverni ishga tushirishda halokatli xato:", err);
  process.exit(1);
});
