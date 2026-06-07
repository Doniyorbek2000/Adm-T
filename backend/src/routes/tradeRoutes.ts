import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listMyTrades, myPortfolioSummary } from "../controllers/tradeController";

const router = Router();

router.use(requireAuth);
router.get("/", listMyTrades);
router.get("/summary", myPortfolioSummary);

export default router;
