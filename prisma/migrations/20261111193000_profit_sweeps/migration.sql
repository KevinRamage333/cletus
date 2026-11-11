-- CreateTable
CREATE TABLE "ProfitSweepState" (
    "id" TEXT NOT NULL DEFAULT 'owner',
    "currentBaseUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nextTargetUsd" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "totalPaidUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confirmedPayoutWallet" TEXT,
    "pendingPayoutWallet" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitSweepState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSweepPayout" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL DEFAULT 'owner',
    "rungKey" TEXT NOT NULL,
    "targetUsd" DOUBLE PRECISION NOT NULL,
    "baseAfterUsd" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "amountLamports" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "memo" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitSweepPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfitSweepPayout_rungKey_key" ON "ProfitSweepPayout"("rungKey");

-- CreateIndex
CREATE INDEX "ProfitSweepPayout_createdAt_idx" ON "ProfitSweepPayout"("createdAt");

-- CreateIndex
CREATE INDEX "ProfitSweepPayout_status_idx" ON "ProfitSweepPayout"("status");

-- AddForeignKey
ALTER TABLE "ProfitSweepPayout" ADD CONSTRAINT "ProfitSweepPayout_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "ProfitSweepState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
