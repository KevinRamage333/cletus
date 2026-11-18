CREATE TABLE "app"."WithdrawConfirmNonce" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawConfirmNonce_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WithdrawConfirmNonce_expiresAt_idx" ON "app"."WithdrawConfirmNonce"("expiresAt");
