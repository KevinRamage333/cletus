CREATE TABLE "app"."DeveloperVerification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mint" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "evidenceUrl" TEXT,
  "statement" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewerId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeveloperVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeveloperVerification_userId_mint_key" ON "app"."DeveloperVerification"("userId", "mint");
CREATE INDEX "DeveloperVerification_status_createdAt_idx" ON "app"."DeveloperVerification"("status", "createdAt");
CREATE INDEX "DeveloperVerification_mint_idx" ON "app"."DeveloperVerification"("mint");
ALTER TABLE "app"."DeveloperVerification" ADD CONSTRAINT "DeveloperVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
