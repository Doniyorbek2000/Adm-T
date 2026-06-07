export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

type AsyncHandler = (...args: any[]) => Promise<any>;

/** Express route handlerlardagi xatoliklarni avtomatik next(err)ga uzatish uchun wrapper */
export function asyncHandler(fn: AsyncHandler) {
  return (req: any, res: any, next: any) => {
    fn(req, res, next).catch(next);
  };
}
