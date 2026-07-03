import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./utils/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/authRoutes";
import brokerAccountRoutes from "./routes/brokerAccountRoutes";
import signalRoutes from "./routes/signalRoutes";
import tradeRoutes from "./routes/tradeRoutes";
import planRoutes from "./routes/planRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import supportRoutes from "./routes/supportRoutes";
import adminRoutes from "./routes/adminRoutes";
import marketRoutes from "./routes/marketRoutes";

export const app = express();

// --- Xavfsizlik qatlamlari ---

// HTTP xavfsizlik sarlavhalari (X-Frame-Options, Content-Security-Policy, ...)
app.use(helmet());

// CORS: faqat ruxsat etilgan frontend domendan so'rovlarga ruxsat
app.use(cors({ origin: env.corsOrigin, credentials: true }));

// JSON tana o'lchamini cheklash — ortiqcha katta so'rovlarni bloklash
app.use(express.json({ limit: "1mb" }));

// Barcha API endpointlar uchun umumiy rate-limit: 1 IP'dan daqiqasiga maks 100 so'rov
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p so'rov yuborildi. Iltimos, biroz kutib turing." },
});
app.use("/api", globalLimiter);

// Auth endpointlar uchun qattiqroq cheklash (brute-force hujumiga qarshi):
// bitta IP'dan 15 daqiqada maks 15 urinish (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." },
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "ADM Trading API", time: new Date().toISOString() });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/signals", signalRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/market", marketRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
