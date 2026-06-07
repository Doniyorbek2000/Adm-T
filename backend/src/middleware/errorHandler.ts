import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }
  console.error(err);
  return res.status(500).json({ message: "Server xatoligi yuz berdi" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: "So'ralgan manzil topilmadi" });
}
