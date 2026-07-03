import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  closeSignal,
  createManualSignal,
  dashboardStats,
  listAllSignals,
  listAllTrades,
  listPlansAdmin,
  listUsers,
  updatePlan,
  updateUser,
} from "../controllers/adminController";
import {
  getConversation,
  listConversations,
  replyToConversation,
  sendBroadcast,
} from "../controllers/supportController";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/stats", dashboardStats);

router.get("/users", listUsers);
router.patch("/users/:id", updateUser);

router.get("/signals", listAllSignals);
router.post("/signals/generate", createManualSignal);
router.patch("/signals/:id/close", closeSignal);

router.get("/plans", listPlansAdmin);
router.patch("/plans/:id", updatePlan);

router.get("/trades", listAllTrades);

router.get("/support", listConversations);
router.get("/support/:userId", getConversation);
router.post("/support/:userId", replyToConversation);

router.post("/notifications", sendBroadcast);

export default router;
