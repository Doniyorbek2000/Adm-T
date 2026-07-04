import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listMyTrades, myPerformance, myPortfolioSummary, closeTrade } from "../controllers/tradeController";

const router = Router();

router.use(requireAuth);
router.get("/", listMyTrades);
router.get("/summary", myPortfolioSummary);
router.get("/performance", myPerformance);
router.post("/:id/close", closeTrade);

export default router;
