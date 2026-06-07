import { Router } from "express";
import { listPlans } from "../controllers/planController";

const router = Router();

// Tarif rejalari ro'yxati - landing sahifada ham ko'rinishi uchun ochiq (auth shart emas)
router.get("/", listPlans);

export default router;
