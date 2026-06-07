import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listNotifications, markAllRead } from "../controllers/notificationController";

const router = Router();

router.use(requireAuth);
router.get("/", listNotifications);
router.post("/mark-all-read", markAllRead);

export default router;
