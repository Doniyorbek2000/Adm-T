import { Router, Request, Response } from "express";
import { fetchSpotPrice } from "../services/exchanges/binance";
import { asyncHandler } from "../utils/AppError";

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

export default router;
