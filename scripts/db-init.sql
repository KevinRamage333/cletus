-- Cletus Postgres bootstrap. Run as the postgres superuser via scripts/db-init.sh.
-- Passwords are read from the environment with \getenv; nothing secret lives in this file.
\set ON_ERROR_STOP on
\getenv app_pw CLETUS_APP_PW
\getenv md_pw CLETUS_MD_PW
\getenv llc_pw CLETUS_LLC_PW
\getenv backup_pw CLETUS_BACKUP_PW

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', r)
FROM unnest(ARRAY['cletus_app','cletus_md','cletus_llc','cletus_backup']) r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

ALTER ROLE cletus_app    PASSWORD :'app_pw'    CONNECTION LIMIT 40;
ALTER ROLE cletus_md     PASSWORD :'md_pw'     CONNECTION LIMIT 10;
ALTER ROLE cletus_llc    PASSWORD :'llc_pw'    CONNECTION LIMIT 5;
ALTER ROLE cletus_backup PASSWORD :'backup_pw' CONNECTION LIMIT 3;

SELECT 'CREATE DATABASE cletus' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'cletus') \gexec
REVOKE ALL ON DATABASE cletus FROM PUBLIC;
GRANT CONNECT ON DATABASE cletus TO cletus_app, cletus_md, cletus_llc, cletus_backup;
GRANT TEMPORARY ON DATABASE cletus TO cletus_app;

\connect cletus
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS app         AUTHORIZATION cletus_app;
CREATE SCHEMA IF NOT EXISTS market_data AUTHORIZATION cletus_md;
CREATE SCHEMA IF NOT EXISTS llc_records AUTHORIZATION cletus_llc;
REVOKE ALL ON SCHEMA app, market_data, llc_records FROM PUBLIC;
ALTER ROLE cletus_app IN DATABASE cletus SET search_path = app;
ALTER ROLE cletus_md  IN DATABASE cletus SET search_path = market_data;
ALTER ROLE cletus_llc IN DATABASE cletus SET search_path = llc_records;

-- The app may READ market data (for native charts) but never write it, and never sees llc_records.
GRANT USAGE ON SCHEMA market_data TO cletus_app;
GRANT SELECT ON ALL TABLES IN SCHEMA market_data TO cletus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cletus_md IN SCHEMA market_data GRANT SELECT ON TABLES TO cletus_app;

-- The backup role is read-only across the database.
GRANT pg_read_all_data TO cletus_backup WITH INHERIT TRUE;
