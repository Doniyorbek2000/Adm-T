import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { prisma } from "../utils/prisma";

export interface AuthedRequest extends Request {
  user?: {
    id: string;
    role: "USER" | "ADMIN";
    plan: "FREE" | "PRO" | "ULTRA" | "VIP";
    fullName: string;
    email: string;
  };
}

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Avtorizatsiya talab qilinadi", 401);
    }
    const token = header.slice("Bearer ".length);
    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      throw new AppError("Foydalanuvchi topilmadi yoki bloklangan", 401);
    }

    // Tarif muddati tugagan bo'lsa FREE ga tushirish
    let effectivePlan = user.plan as "FREE" | "PRO" | "ULTRA" | "VIP";
    if (effectivePlan !== "FREE" && user.planExpiresAt && new Date() > user.planExpiresAt) {
      effectivePlan = "FREE";
      await prisma.user.update({ where: { id: user.id }, data: { plan: "FREE", planExpiresAt: null } });
    }

    req.user = {
      id: user.id,
      role: user.role as "USER" | "ADMIN",
      plan: effectivePlan,
      fullName: user.fullName,
      email: user.email,
    };
    next();
  } catch (err) {
    next(new AppError("Token yaroqsiz yoki muddati tugagan", 401));
  }
}

export function requireAdmin(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return next(new AppError("Faqat administrator uchun ruxsat etilgan", 403));
  }
  next();
}
