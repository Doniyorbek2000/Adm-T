import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    return res.status(400).json({ message: "Kiritilgan ma'lumotlar noto'g'ri", errors: messages });
  }

  // Production'da ichki xato tafsilotlarini foydalanuvchiga oshkor qilmaymiz
  console.error("[Unhandled Error]", err instanceof Error ? err.stack : err);
  return res.status(500).json({ message: "Server xatoligi yuz berdi" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: "So'ralgan manzil topilmadi" });
}
