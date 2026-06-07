import express from "express";
import cors from "cors";
import { env } from "./utils/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/authRoutes";
import brokerAccountRoutes from "./routes/brokerAccountRoutes";
import signalRoutes from "./routes/signalRoutes";
import tradeRoutes from "./routes/tradeRoutes";
import planRoutes from "./routes/planRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import adminRoutes from "./routes/adminRoutes";

export const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "ADM Trading API", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/broker-accounts", brokerAccountRoutes);
app.use("/api/signals", signalRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
