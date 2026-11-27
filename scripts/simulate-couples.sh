#!/usr/bin/env bash
# Simulated couples against public.suggest_names on a LOCAL database. See docs/simulated-couples.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PGDATABASE="${PGDATABASE:-swiper_sim}"
P=(psql -X -q -v ON_ERROR_STOP=1)

# Local only: refuse anything that is not a unix socket or loopback connection.
addr="$("${P[@]}" -At -c "select coalesce(host(inet_server_addr()), 'socket')")"
case "$addr" in socket|127.*|::1) ;; *) echo "Refusing: connected to non-local server ($addr)" >&2; exit 1;; esac
"${P[@]}" -At -c "select 1 from pg_proc where proname = 'suggest_names'" | grep -q 1 \
  || { echo "public.suggest_names not found: run scripts/sim/setup-local-db.sh first" >&2; exit 1; }

# Baseline is the current suggest_names. Add variants as label=schema.function once the Pending
# boost / Rejected signal exist, e.g. VARIANTS="baseline=public.suggest_names,boost=public.suggest_names_boost".
# "random=random" adds a no-taste control deck.
exec "${P[@]}" \
  -v couples="${COUPLES:-30}" -v overlaps="${OVERLAPS:-0,0.5,0.9}" -v like_rate="${LIKE_RATE:-0.25}" \
  -v noise="${NOISE:-0.5}" -v seed="${SEED:-0.42}" -v genders="${GENDERS:-girl}" \
  -v variants="${VARIANTS:-baseline=public.suggest_names}" -v batch="${BATCH:-10}" \
  -v max_swipes="${MAX_SWIPES:-20000}" -f "$HERE/sim/simulate-couples.sql"
