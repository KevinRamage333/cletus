-- Cletus production Postgres: llc_records and market_data DDL (the `app` schema is Prisma-managed).
-- Applied by scripts/db-init.sh as the superuser; each block runs as the schema's owning role.
-- Idempotent: safe to re-run.
\set ON_ERROR_STOP on

-- ───────────────────────── llc_records (owner: cletus_llc) ─────────────────────────
SET ROLE cletus_llc;
SET search_path = llc_records;

CREATE TABLE IF NOT EXISTS expenses (
  id             bigserial PRIMARY KEY,
  incurred_on    date NOT NULL,
  vendor         text NOT NULL,
  category       text NOT NULL,              -- hosting, rpc, api, legal, trademark, other
  amount_usd     numeric(14,2) NOT NULL CHECK (amount_usd >= 0),
  currency       text NOT NULL DEFAULT 'USD',
  payment_method text,                       -- free text, e.g. "LLC card"; never full card numbers
  receipt_uri    text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_incurred_on ON expenses (incurred_on);

CREATE TABLE IF NOT EXISTS contracts (
  id            bigserial PRIMARY KEY,
  counterparty  text NOT NULL,
  title         text NOT NULL,
  signed_on     date,
  renews_on     date,
  value_usd     numeric(14,2),
  document_uri  text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','expired','terminated')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ideas_log (
  id         bigserial PRIMARY KEY,
  logged_on  date NOT NULL,
  idea       text NOT NULL,
  notes      text,
  source     text NOT NULL DEFAULT 'docs/IDEAS_LOG.md',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logged_on, idea)
);
RESET ROLE;

-- ───────────────────────── market_data (owner: cletus_md) ─────────────────────────
SET ROLE cletus_md;
SET search_path = market_data;

CREATE TABLE IF NOT EXISTS pools (
  address        text PRIMARY KEY,
  dex            text NOT NULL DEFAULT 'unknown',
  base_mint      text NOT NULL,
  quote_mint     text,
  base_symbol    text,
  quote_symbol   text,
  created_slot   bigint,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz
);

-- Raw swaps (future Helius-stream indexer). Range-partitioned by block_time; a DEFAULT partition
-- catches everything until daily partitions are created by the indexer/cron.
CREATE TABLE IF NOT EXISTS swaps (
  signature    text NOT NULL,
  pool         text NOT NULL REFERENCES pools(address),
  slot         bigint NOT NULL,
  block_time   timestamptz NOT NULL,
  side         text NOT NULL CHECK (side IN ('buy','sell')),
  base_amount  numeric NOT NULL,
  quote_amount numeric NOT NULL,
  price_usd    numeric,
  trader       text,
  PRIMARY KEY (block_time, signature, pool)
) PARTITION BY RANGE (block_time);
CREATE TABLE IF NOT EXISTS swaps_default PARTITION OF swaps DEFAULT;
CREATE INDEX IF NOT EXISTS swaps_pool_time ON swaps (pool, block_time);

-- 1-minute candles. source = 'geckoterminal' (current collector) or 'helius' (future indexer).
CREATE TABLE IF NOT EXISTS candles_1m (
  pool        text NOT NULL REFERENCES pools(address),
  bucket      timestamptz NOT NULL,
  open        numeric NOT NULL,
  high        numeric NOT NULL,
  low         numeric NOT NULL,
  close       numeric NOT NULL,
  volume_usd  numeric NOT NULL DEFAULT 0,
  trades      int,
  source      text NOT NULL DEFAULT 'geckoterminal',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pool, bucket)
);
CREATE INDEX IF NOT EXISTS candles_1m_bucket ON candles_1m (bucket);

-- Roll-ups computed on read from 1m candles (materialize later if needed).
CREATE OR REPLACE FUNCTION rollup_candles(res interval)
RETURNS TABLE (pool text, bucket timestamptz, open numeric, high numeric, low numeric, close numeric, volume_usd numeric)
LANGUAGE sql STABLE AS $$
  SELECT c.pool,
         date_bin(res, c.bucket, timestamptz '2000-01-01') AS b,
         (array_agg(c.open  ORDER BY c.bucket ASC))[1],
         max(c.high), min(c.low),
         (array_agg(c.close ORDER BY c.bucket DESC))[1],
         sum(c.volume_usd)
  FROM market_data.candles_1m c
  GROUP BY c.pool, b
$$;
CREATE OR REPLACE VIEW candles_5m AS SELECT * FROM rollup_candles(interval '5 minutes');
CREATE OR REPLACE VIEW candles_1h AS SELECT * FROM rollup_candles(interval '1 hour');
CREATE OR REPLACE VIEW candles_1d AS SELECT * FROM rollup_candles(interval '1 day');
RESET ROLE;

-- Views/functions created above are covered by cletus_md's default privileges for tables;
-- grant explicitly so re-runs stay correct.
-- Backtest history (scripts/backtest/backfill-gecko.ts): 5-minute GeckoTerminal candles and pool snapshots.
SET ROLE cletus_md;
CREATE TABLE IF NOT EXISTS market_data.ohlcv_5m (
  pool text NOT NULL REFERENCES market_data.pools(address), bucket timestamptz NOT NULL,
  open numeric NOT NULL, high numeric NOT NULL, low numeric NOT NULL, close numeric NOT NULL, volume_usd numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'geckoterminal', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (pool, bucket));
CREATE TABLE IF NOT EXISTS market_data.pool_snapshots (
  pool text NOT NULL REFERENCES market_data.pools(address), taken_at timestamptz NOT NULL DEFAULT now(),
  price_usd numeric, fdv_usd numeric, mcap_usd numeric, reserve_usd numeric, pool_created_at timestamptz, discovered_via text,
  PRIMARY KEY (pool, taken_at));
RESET ROLE;

GRANT SELECT ON ALL TABLES IN SCHEMA market_data TO cletus_app;
GRANT EXECUTE ON FUNCTION market_data.rollup_candles(interval) TO cletus_app;
