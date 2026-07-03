import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  connectAccount,
  createDemoAccount,
  deleteAccount,
  listAccounts,
  syncBalance,
  updateAccount,
} from "../controllers/brokerAccountController";

const router = Router();

router.use(requireAuth);
router.get("/", listAccounts);
router.post("/", connectAccount);
router.post("/demo", createDemoAccount);
router.patch("/:id", updateAccount);
router.post("/:id/sync", syncBalance);
router.delete("/:id", deleteAccount);

export default router;
