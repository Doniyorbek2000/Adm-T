import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  closeSignal,
  createManualSignal,
  dashboardStats,
  getEngineStatus,
  listAllSignals,
  listAllTrades,
  listPlansAdmin,
  listUsers,
  updateEngineStatus,
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

// AI dvigatel kill-switch (favqulodda to'xtatish)
router.get("/engine", getEngineStatus);
router.patch("/engine", updateEngineStatus);

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
