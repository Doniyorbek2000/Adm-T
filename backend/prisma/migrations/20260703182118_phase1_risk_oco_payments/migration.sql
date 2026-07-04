-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "amountUzs" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "providerTransId" TEXT;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "feeUsd" REAL;
ALTER TABLE "Trade" ADD COLUMN "ocoOrderListId" TEXT;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
