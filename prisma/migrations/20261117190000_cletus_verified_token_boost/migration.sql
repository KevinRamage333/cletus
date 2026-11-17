-- Cletus Verified + Token Boost (display-only listing data). Not applied automatically.
CREATE TABLE IF NOT EXISTS "app"."CletusVerification" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "name" TEXT,
  "symbol" TEXT,
  "wallet" TEXT NOT NULL,
  "role" TEXT,
  "status" TEXT NOT NULL,
  "reasons" JSONB NOT NULL,
  "checks" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CletusVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CletusVerification_network_token_createdAt_idx" ON "app"."CletusVerification"("network", "token", "createdAt");
CREATE INDEX IF NOT EXISTS "CletusVerification_status_expiresAt_idx" ON "app"."CletusVerification"("status", "expiresAt");

CREATE TABLE IF NOT EXISTS "app"."TokenBoost" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenBoost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TokenBoost_network_token_expiresAt_idx" ON "app"."TokenBoost"("network", "token", "expiresAt");
CREATE INDEX IF NOT EXISTS "TokenBoost_expiresAt_idx" ON "app"."TokenBoost"("expiresAt");
