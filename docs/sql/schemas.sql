-- DRAFT (not applied). Cletus production Postgres: logical areas and least-privilege roles.
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS llc_records;
CREATE SCHEMA IF NOT EXISTS market_data;

-- Roles (set passwords out of band; never commit them)
-- CREATE ROLE cletus_app LOGIN; CREATE ROLE cletus_md LOGIN; CREATE ROLE cletus_llc LOGIN; CREATE ROLE cletus_backup LOGIN;
-- GRANT USAGE, CREATE ON SCHEMA app TO cletus_app;
-- GRANT USAGE ON SCHEMA market_data TO cletus_app;  -- read-only below
-- GRANT USAGE, CREATE ON SCHEMA market_data TO cletus_md;
-- GRANT USAGE, CREATE ON SCHEMA llc_records TO cletus_llc;
-- ALTER DEFAULT PRIVILEGES FOR ROLE cletus_md IN SCHEMA market_data GRANT SELECT ON TABLES TO cletus_app;
-- REVOKE ALL ON SCHEMA llc_records FROM PUBLIC;

CREATE TABLE IF NOT EXISTS llc_records.expenses (
  id bigserial PRIMARY KEY, incurred_on date NOT NULL, vendor text NOT NULL, category text NOT NULL,
  amount_usd numeric(14,2) NOT NULL, currency text NOT NULL DEFAULT 'USD', payment_method text, receipt_uri text, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS llc_records.contracts (
  id bigserial PRIMARY KEY, counterparty text NOT NULL, title text NOT NULL, signed_on date, renews_on date,
  value_usd numeric(14,2), document_uri text, status text NOT NULL DEFAULT 'active', notes text
);
CREATE TABLE IF NOT EXISTS llc_records.ideas_log (
  id bigserial PRIMARY KEY, logged_on date NOT NULL, idea text NOT NULL, notes text, source text
);

CREATE TABLE IF NOT EXISTS market_data.pools (
  address text PRIMARY KEY, dex text NOT NULL, base_mint text NOT NULL, quote_mint text NOT NULL,
  created_slot bigint, first_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_data.swaps (
  signature text NOT NULL, pool text NOT NULL REFERENCES market_data.pools(address), slot bigint NOT NULL, block_time timestamptz NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')), base_amount numeric NOT NULL, quote_amount numeric NOT NULL, price_usd numeric, trader text,
  PRIMARY KEY (block_time, signature, pool)
) PARTITION BY RANGE (block_time);
CREATE TABLE IF NOT EXISTS market_data.candles_1m (
  pool text NOT NULL REFERENCES market_data.pools(address), bucket timestamptz NOT NULL,
  open numeric NOT NULL, high numeric NOT NULL, low numeric NOT NULL, close numeric NOT NULL, volume_usd numeric NOT NULL DEFAULT 0, trades int NOT NULL DEFAULT 0,
  PRIMARY KEY (pool, bucket)
);
CREATE INDEX IF NOT EXISTS candles_1m_bucket ON market_data.candles_1m (bucket);
