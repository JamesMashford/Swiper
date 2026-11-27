# Simulated couples (match rate and deck depth)

`scripts/simulate-couples.sh` plays simulated couples against `public.suggest_names` on a **local** Postgres and reports match rate, time to first match and deck depth. It is for issue #11 (part of #4): there are only two real users, so we tune with simulated ones.

## Run it

You need a local Postgres 14+ (`psql` on the path) and a role that can create databases.

```bash
# 1. Build a scratch database: Supabase stubs (roles, auth.users, auth.uid()), the repo's migrations, the seed.
PGHOST=localhost PGUSER=postgres bash scripts/sim/setup-local-db.sh        # creates "swiper_sim"

# 2. Simulate.
PGHOST=localhost PGUSER=postgres scripts/simulate-couples.sh
```

Notes:
- Local only. Both scripts refuse a non-loopback / non-socket server. No Supabase credentials are used or needed. Setup drops and recreates the scratch database, so never point it at anything you care about.
- The simulation runs in one transaction that is rolled back, so it leaves the database as it found it. It takes about 30 s with the defaults.
- `pgvector` is not needed. Migration 1 only uses it for `names.embedding`, which stays null in v1, so setup swaps that column type on a temporary copy of the migration. The repo's migration files are not changed.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PGDATABASE` | `swiper_sim` | Database to use |
| `COUPLES` | `30` | Couples per overlap and variant |
| `OVERLAPS` | `0,0.5,0.9` | Taste overlap values: 0 = unrelated taste, 1 = same taste |
| `LIKE_RATE` | `0.25` | Share of the deck each partner would like |
| `NOISE` | `0.5` | Per-name randomness on top of taste (higher = less predictable) |
| `GENDERS` | `girl` | Nursery gender filter, comma separated (`girl`, `boy,neutral`, ...). All origins. |
| `BATCH` | `10` | Names per `suggest_names` call |
| `SEED` | `0.42` | Between -1 and 1. Same seed and same data gives the same report |
| `VARIANTS` | `baseline=public.suggest_names` | Comma separated `label=schema.function` pairs to compare |

## Comparing the Pending boost and the Rejected signal

The comparison is switched with `VARIANTS`. Each variant is a function with the same shape as `suggest_names(int)`. Every variant is run on the same simulated couples and tastes, so differences come from the function, not from luck.

```bash
VARIANTS="baseline=public.suggest_names,boost=public.suggest_names_boost" scripts/simulate-couples.sh
```

Today only `baseline` exists (the Pending boost and Rejected signal are issues #7 and #8). When they land, either point a variant at the new function, or keep one function and add a flag. `random=random` adds a control deck with no taste ranking at all, which shows how much the current ranking helps.

## How a simulated couple works

- Each partner has a random weight for every tag, origin and syllable count. Partner B's weights are `overlap * A + sqrt(1 - overlap^2) * independent`. A name's appeal is its mean token weight plus noise; a partner likes the top `LIKE_RATE` share of the names the filter allows.
- Partners swipe in turn, one batch each, swiping every name they are offered, until `suggest_names` returns nothing (deck dry).
- This is a model, not real taste. It rewards the same signals `suggest_names` uses (tags, origins, syllables), so it tests the mechanics, not whether people really behave that way. Likes and dislikes are only ever "like the top `LIKE_RATE`" or not.

## Reading the report

- **% matched / median swipes to 1st match**: swipes are both partners combined. The median counts couples that matched.
- **matches/100 swipes (whole run)**: once a deck runs dry every mutual like has become a match, so this number only depends on the data and the overlap; it does not separate variants. Use the `@50/@100/@200` columns, which count matches after that many combined swipes, to compare how fast variants find matches. If a deck runs dry first, the final count is used.
- **reachable matches**: names both partners would like, the ceiling on matches for that couple.
- **Deck target**: counts names per gender in the database against the 1,000 target, and checks that no name was offered twice to the same partner.
- **Embeddings**: the script does not decide. The issue sets no threshold for a "low" match rate, so compare variants and the reachable ceiling and decide from there. With a small deck (see the seed size) the answer is weak.
