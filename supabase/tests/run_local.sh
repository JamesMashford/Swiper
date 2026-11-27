#!/usr/bin/env bash
# Build a scratch database on a local Postgres, apply the shim and every migration in
# order, then run the SQL tests. Never touches a live Supabase project.
#   PSQL="psql -h /socket/dir -p 5497 -U postgres" bash supabase/tests/run_local.sh [test.sql ...]
# With no test files given, runs every supabase/tests/*_test.sql.
set -euo pipefail
: "${PSQL:?set PSQL to a psql command line without -d}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="swiper_test_$$"
$PSQL -d postgres -q -c "create database $db"
trap '$PSQL -d postgres -q -c "drop database if exists $db"' EXIT
run() { $PSQL -d "$db" -q -v ON_ERROR_STOP=1 "$@"; }
run -f "$root/supabase/tests/local_supabase_shim.sql"
for m in "$root"/supabase/migrations/*.sql; do
  echo "migration $(basename "$m")"
  sed 's/extensions\.vector(384)/real[]/; s/create extension if not exists vector.*/-- vector skipped locally/' "$m" | run -f -
done
tests=("$@"); [ ${#tests[@]} -gt 0 ] || tests=("$root"/supabase/tests/*_test.sql)
for t in "${tests[@]}"; do echo "test $(basename "$t")"; run -f "$t"; done
