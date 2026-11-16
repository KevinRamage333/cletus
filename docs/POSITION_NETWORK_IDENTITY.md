# Position network identity

## Change

Every persisted `Position` now has a required `network` string. The initial supported identifier is `solana`; the value uses the IDs from `src/lib/multichain.ts` (for example `base`, `ethereum`, and `sui`).

The migration adds the column with a database default of `solana`. This is a deliberate backfill: the pre-migration application and all existing position creation paths are Solana-specific. Existing rows therefore retain their meaning without a destructive rewrite or manual data update.

A compound index on `(accountId, network, mint)` supports chain-qualified position lookups. The old `(accountId, mint)` index remains temporarily so existing Solana-only query paths keep their current performance and behavior.

## Rules for future adapters

- Every new position write must set `network` explicitly from the adapter/validated trade intent; do not rely on the Solana default outside legacy Solana code.
- Every multi-chain read, update, close, or deduplication query must scope by `accountId + network + mint` (and by `pairAddress` where pool identity is needed).
- Never infer a chain from the token address, symbol, or pair address.
- Keep legacy Solana paths explicit before enabling any non-Solana adapter. The default exists for backward compatibility, not as a fallback for unknown networks.
- Do not enable a network for paper trading until its adapter, quote validation, fee/fill model, and chain-scoped position tests pass.

## Apply and verify

Deploy with the normal migration workflow:

```bash
npm run db:migrate
```

For SQLite development, regenerate the derived schema and push it using the existing `npm run db:sqlite` workflow.

Verify the migration on PostgreSQL:

```sql
SELECT "network", COUNT(*) FROM "Position" GROUP BY "network";
SELECT indexname FROM pg_indexes
WHERE schemaname = 'app' AND tablename = 'Position'
  AND indexname = 'Position_accountId_network_mint_idx';
```

All pre-existing positions should report `solana`. This schema change does not enable multi-chain trading or change live-trading settings; paper trading remains the intended validation mode.
