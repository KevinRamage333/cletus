-- Persist completion of the five-stage financial understanding gate.
ALTER TABLE "User"
  ADD COLUMN "financialConsentVersion" TEXT,
  ADD COLUMN "financialConsentAt" TIMESTAMP(3);
