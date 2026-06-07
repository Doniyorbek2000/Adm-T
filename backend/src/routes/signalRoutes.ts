import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listSignals, signalStats } from "../controllers/signalController";

const router = Router();

router.use(requireAuth);
router.get("/", listSignals);
router.get("/stats", signalStats);

export default router;
