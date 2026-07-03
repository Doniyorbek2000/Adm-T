-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BrokerAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Asosiy hisob',
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiSecretEncrypted" TEXT NOT NULL,
    "passphraseEncrypted" TEXT,
    "server" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'SIGNAL_ONLY',
    "marketType" TEXT NOT NULL DEFAULT 'SPOT',
    "riskLevel" INTEGER NOT NULL DEFAULT 2,
    "balanceUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BrokerAccount" ("apiKeyEncrypted", "apiSecretEncrypted", "balanceUsd", "createdAt", "exchange", "id", "isConnected", "label", "mode", "passphraseEncrypted", "riskLevel", "server", "userId") SELECT "apiKeyEncrypted", "apiSecretEncrypted", "balanceUsd", "createdAt", "exchange", "id", "isConnected", "label", "mode", "passphraseEncrypted", "riskLevel", "server", "userId" FROM "BrokerAccount";
DROP TABLE "BrokerAccount";
ALTER TABLE "new_BrokerAccount" RENAME TO "BrokerAccount";
CREATE TABLE "new_Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT,
    "signalId" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "quantity" REAL NOT NULL,
    "pnlUsd" REAL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "executedByAi" BOOLEAN NOT NULL DEFAULT true,
    "executionMode" TEXT NOT NULL DEFAULT 'SIMULATED',
    "externalOrderId" TEXT,
    "ocoOrderListId" TEXT,
    "feeUsd" REAL,
    "marketType" TEXT NOT NULL DEFAULT 'SPOT',
    "stopLossPrice" REAL,
    "takeProfitPrice" REAL,
    "breakEvenApplied" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trade_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Trade" ("brokerAccountId", "closedAt", "direction", "entryPrice", "executedByAi", "executionMode", "exitPrice", "externalOrderId", "feeUsd", "id", "ocoOrderListId", "openedAt", "pnlUsd", "quantity", "signalId", "status", "symbol", "userId") SELECT "brokerAccountId", "closedAt", "direction", "entryPrice", "executedByAi", "executionMode", "exitPrice", "externalOrderId", "feeUsd", "id", "ocoOrderListId", "openedAt", "pnlUsd", "quantity", "signalId", "status", "symbol", "userId" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
