import { Router, Request, Response } from "express";
import { z } from "zod";
import { backtestSymbol } from "../services/backtest";
import { fetchSpotPrice } from "../services/exchanges/binance";
import { requireAuth } from "../middleware/auth";
import { AppError, asyncHandler } from "../utils/AppError";

const router = Router();

/** GET /api/market/prices?symbols=BTC/USDT,ETH/USDT  — public, no auth required */
router.get(
  "/prices",
  asyncHandler(async (req: Request, res: Response) => {
    const symbolsParam = (req.query.symbols as string) ?? "";
    if (!symbolsParam.trim()) {
      return res.json({ prices: {} });
    }

    const symbols = symbolsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12); // max 12 symbols per request

    const prices: Record<string, number> = {};

    await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          prices[symbol] = await fetchSpotPrice(symbol);
        } catch {
          // silently skip unavailable symbols
        }
      })
    );

    res.json({ prices });
  })
);

// Backtest qilish mumkin bo'lgan juftliklar — AI kuzatadigan ro'yxat bilan bir xil
const BACKTEST_SYMBOLS = new Set([
  "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT",
  "XRP/USDT", "TON/USDT", "ADA/USDT", "AVAX/USDT",
]);

const backtestQuerySchema = z.object({
  symbol: z.string().default("BTC/USDT"),
  interval: z.enum(["15m", "1h", "4h"]).default("1h"),
  days: z.coerce.number().int().min(7).max(90).default(30),
});

/**
 * GET /api/market/backtest?symbol=BTC/USDT&interval=1h&days=30
 * AI strategiyasining tarixiy natijasi: win-rate, profit factor, max drawdown,
 * kapital egri chizig'i. Natija 1 soat keshlanadi (Binance yuklamasini cheklash).
 */
router.get(
  "/backtest",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const query = backtestQuerySchema.parse(req.query);

    if (!BACKTEST_SYMBOLS.has(query.symbol)) {
      throw new AppError(`Noto'g'ri simvol. Ruxsat etilgan: ${[...BACKTEST_SYMBOLS].join(", ")}`, 400);
    }

    const result = await backtestSymbol(query.symbol, query.interval, query.days);
    res.json({ backtest: result });
  })
);

export default router;
