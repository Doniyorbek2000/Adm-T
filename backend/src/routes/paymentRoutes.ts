import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { myPayments, subscribe } from "../controllers/paymentController";

const router = Router();

router.use(requireAuth);
router.post("/subscribe", subscribe);
router.get("/", myPayments);

export default router;
