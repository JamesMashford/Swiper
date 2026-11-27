#!/usr/bin/env bash
# Builds a throwaway LOCAL Postgres database for the couples simulation:
# Supabase role/auth stubs, then the repo's migrations and seed, unchanged.
# Usage: PGHOST=localhost PGUSER=postgres bash scripts/sim/setup-local-db.sh [dbname]
# Never point this at a hosted project: it drops and recreates the database.
set -euo pipefail
DB="${1:-swiper_sim}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
host="${PGHOST:-localhost}"
case "$host" in localhost|127.*|::1|/*) ;; *) echo "Refusing: PGHOST=$host is not local" >&2; exit 1;; esac
P="psql -X -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
$P -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
-- Same contract as Supabase: the caller id comes from the request JWT claim.
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create publication supabase_realtime;
grant usage on schema auth, extensions, public to anon, authenticated;
SQL
# pgvector is not available in every local Postgres. Migration 1 only needs it for a column that
# stays null in v1, so on a temporary COPY we swap the type; repo files are not modified.
tmp="$(mktemp -d)"
sed -e '/^create extension if not exists vector/d' -e 's/extensions\.vector(384)/real[]/' \
  "$ROOT/supabase/migrations/20261108000000_initial_schema.sql" > "$tmp/m1.sql"
$P -d "$DB" -f "$tmp/m1.sql"
for f in 20261108000100_nursery_update_columns 20261108000200_table_grants 20261110000000_v1_features; do
  $P -d "$DB" -f "$ROOT/supabase/migrations/$f.sql"
done
$P -d "$DB" -f "$ROOT/supabase/seed/names_starter.sql"
rm -rf "$tmp"
$P -d "$DB" -Atc "select 'names: ' || count(*) from public.names"
