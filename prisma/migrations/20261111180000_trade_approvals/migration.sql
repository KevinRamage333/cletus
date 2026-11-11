-- CreateTable
CREATE TABLE "TradeApproval" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "sizeUsd" DOUBLE PRECISION NOT NULL,
    "inputMint" TEXT NOT NULL,
    "outputMint" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "inAmount" TEXT,
    "outAmount" TEXT,
    "requestId" TEXT,
    "transaction" TEXT,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "operatorFeeBps" INTEGER NOT NULL DEFAULT 50,
    "operatorFeeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceImpactPct" DOUBLE PRECISION,
    "reason" TEXT,
    "score" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TradeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeApproval_accountId_status_idx" ON "TradeApproval"("accountId", "status");

-- CreateIndex
CREATE INDEX "TradeApproval_expiresAt_idx" ON "TradeApproval"("expiresAt");

-- AddForeignKey
ALTER TABLE "TradeApproval" ADD CONSTRAINT "TradeApproval_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
