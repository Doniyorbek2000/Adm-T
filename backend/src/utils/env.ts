import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  encryptionKey: required("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef"),
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@admtrading.uz",
  adminPassword: process.env.ADMIN_PASSWORD ?? "Admin123!",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
