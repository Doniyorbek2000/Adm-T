import { Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";
import { Role, SenderRole } from "../constants/enums";

/* -------------------------------------------------------------------------- */
/* Foydalanuvchi tomoni - admin bilan yozishish                               */
/* -------------------------------------------------------------------------- */

export const getMyThread = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const messages = await prisma.supportMessage.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.supportMessage.updateMany({
    where: { userId: req.user!.id, senderRole: SenderRole.ADMIN, isRead: false },
    data: { isRead: true },
  });

  res.json({ messages });
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Xabar matni bo'sh bo'lishi mumkin emas").max(2000),
});

export const sendMyMessage = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = sendMessageSchema.parse(req.body);

  const message = await prisma.supportMessage.create({
    data: { userId: req.user!.id, senderRole: SenderRole.USER, body: data.body },
  });

  res.status(201).json({ message });
});

/* -------------------------------------------------------------------------- */
/* Admin tomoni - barcha suhbatlarni boshqarish                               */
/* -------------------------------------------------------------------------- */

export const listConversations = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const users = await prisma.user.findMany({
    where: { role: Role.USER, supportMessages: { some: {} } },
    select: {
      id: true,
      fullName: true,
      email: true,
      plan: true,
      supportMessages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: {
          supportMessages: { where: { senderRole: SenderRole.USER, isRead: false } },
        },
      },
    },
  });

  const conversations = users
    .map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      plan: u.plan,
      lastMessage: u.supportMessages[0] ?? null,
      unreadCount: u._count.supportMessages,
    }))
    .sort((a, b) => {
      const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bt - at;
    });

  res.json({ conversations });
});

export const getConversation = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { id: true, fullName: true, email: true, plan: true },
  });
  if (!user) throw new AppError("Foydalanuvchi topilmadi", 404);

  const messages = await prisma.supportMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.supportMessage.updateMany({
    where: { userId: user.id, senderRole: SenderRole.USER, isRead: false },
    data: { isRead: true },
  });

  res.json({ user, messages });
});

export const replyToConversation = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = sendMessageSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) throw new AppError("Foydalanuvchi topilmadi", 404);

  const message = await prisma.supportMessage.create({
    data: { userId: user.id, senderRole: SenderRole.ADMIN, body: data.body },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: "Qo'llab-quvvatlash xizmatidan yangi javob",
      message: "Administrator sizning murojaatingizga javob yozdi. Yordam bo'limida ko'ring.",
    },
  });

  res.status(201).json({ message });
});

/* -------------------------------------------------------------------------- */
/* Admin - barcha foydalanuvchilarga yoki bittasiga xabar yuborish (broadcast) */
/* -------------------------------------------------------------------------- */

const broadcastSchema = z.object({
  userId: z.string().optional(),
  title: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(2000),
});

export const sendBroadcast = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = broadcastSchema.parse(req.body);

  if (data.userId) {
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new AppError("Foydalanuvchi topilmadi", 404);

    await prisma.notification.create({
      data: { userId: user.id, title: data.title, message: data.message },
    });

    return res.status(201).json({ message: `Xabar "${user.fullName}" foydalanuvchisiga yuborildi` });
  }

  const users = await prisma.user.findMany({ where: { role: Role.USER }, select: { id: true } });
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, title: data.title, message: data.message })),
  });

  res.status(201).json({ message: `Xabar barcha foydalanuvchilarga (${users.length} ta) yuborildi` });
});
