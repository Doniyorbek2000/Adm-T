import { Response } from "express";
import { prisma } from "../utils/prisma";
import { asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";

export const listNotifications = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
  res.json({ notifications, unreadCount });
});

export const markAllRead = asyncHandler(async (req: AuthedRequest, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  res.json({ message: "Barcha bildirishnomalar o'qilgan deb belgilandi" });
});
