-- Existing Position rows were produced by the Solana-only engine.
-- Backfill them explicitly as Solana while adding chain-qualified identity.
ALTER TABLE "Position"
ADD COLUMN "network" TEXT NOT NULL DEFAULT 'solana';

-- Keep the legacy (accountId, mint) index for current Solana-only call sites.
-- New multi-chain queries must include network in their lookup predicate.
CREATE INDEX "Position_accountId_network_mint_idx"
ON "Position"("accountId", "network", "mint");
