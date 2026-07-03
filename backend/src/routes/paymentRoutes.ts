import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { clickWebhook, myPayments, paymeWebhook, subscribe } from "../controllers/paymentController";

const router = Router();

// Webhook endpointlar — autentifikatsiya talab qilmaydi (to'lov provayderining
// o'z serverlari chaqiradi, har bir webhook o'z imzo/auth tekshiruviga ega)
router.post("/webhook/click", clickWebhook as any);
router.post("/webhook/payme", paymeWebhook as any);

router.use(requireAuth);
router.post("/subscribe", subscribe);
router.get("/", myPayments);

export default router;
