import { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { signToken } from "../utils/jwt";
import { AppError, asyncHandler } from "../utils/AppError";
import { AuthedRequest } from "../middleware/auth";

const registerSchema = z.object({
  fullName: z
    .string()
    .min(2, "Ism kamida 2 ta belgidan iborat bo'lishi kerak")
    .max(100, "Ism juda uzun"),
  email: z.string().email("Email noto'g'ri formatda").max(254),
  password: z
    .string()
    .min(8, "Parol kamida 8 ta belgidan iborat bo'lishi kerak")
    .max(128, "Parol juda uzun")
    .regex(/[A-Z]/, "Parolda kamida 1 ta katta harf bo'lishi kerak")
    .regex(/[a-z]/, "Parolda kamida 1 ta kichik harf bo'lishi kerak")
    .regex(/[0-9]/, "Parolda kamida 1 ta raqam bo'lishi kerak"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(user: { id: string; fullName: string; email: string; role: string; plan: string; planExpiresAt: Date | null; createdAt: Date }) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    plan: user.plan,
    planExpiresAt: user.planExpiresAt,
    createdAt: user.createdAt,
  };
}

export const register = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    throw new AppError("Bu email bilan foydalanuvchi allaqachon ro'yxatdan o'tgan", 409);
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      fullName: data.fullName,
      email: data.email.toLowerCase(),
      passwordHash,
    },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: "ADM Trading'ga xush kelibsiz!",
      message:
        "Ro'yxatdan muvaffaqiyatli o'tdingiz. Endi broker hisobingizni ulang yoki tarif tanlab, AI signallaridan foydalanishni boshlang.",
    },
  });

  const token = signToken({ userId: user.id, role: user.role as "USER" | "ADMIN" });
  res.status(201).json({ token, user: publicUser(user) });
});

export const login = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user) {
    throw new AppError("Email yoki parol noto'g'ri", 401);
  }
  if (!user.isActive) {
    throw new AppError("Sizning hisobingiz bloklangan. Administrator bilan bog'laning.", 403);
  }

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    throw new AppError("Email yoki parol noto'g'ri", 401);
  }

  const token = signToken({ userId: user.id, role: user.role as "USER" | "ADMIN" });
  res.json({ token, user: publicUser(user) });
});

export const me = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw new AppError("Foydalanuvchi topilmadi", 404);
  res.json({ user: publicUser(user) });
});
