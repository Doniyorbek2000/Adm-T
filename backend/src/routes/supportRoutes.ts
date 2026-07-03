import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMyThread, sendMyMessage } from "../controllers/supportController";

const router = Router();

router.use(requireAuth);

router.get("/", getMyThread);
router.post("/", sendMyMessage);

export default router;
