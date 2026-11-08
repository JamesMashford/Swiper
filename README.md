# Swiper

Pair with a partner and see where your matches are using swipes.

Two expectant parents link accounts, swipe on baby names, and get suggestions weighted toward names they both like. See [PLAN.md](PLAN.md) for the v1 plan.

## Layout

| Path | Contents |
|---|---|
| `app/` | Mobile-first PWA: React, Vite, TypeScript, Tailwind |
| `supabase/migrations/` | Postgres schema, RLS policies and RPCs |
| `scripts/` | Offline name-data pipeline (`import-ssa.mjs`) |

## Run the app

```sh
cd app
cp .env.example .env.local   # fill in once a Supabase project exists
npm install
npm run dev
```

The app boots without Supabase credentials and shows a notice until they are set.



## Database

`supabase/migrations/20261108000000_initial_schema.sql` creates the tables, row level security, match triggers and the `create_nursery` / `join_nursery` RPCs. Apply it with the Supabase CLI (`supabase db push`) or paste it into the SQL editor of a new project.

Privacy rule: partners can never read each other's swipes; they only see `matches`.

## Name import

```sh
node scripts/import-ssa.mjs <dir-with-yobYYYY.txt-files> --min 20000
```

Writes `data/names.seed.json` (gitignored). Tagging with Claude and embeddings are the next pipeline steps.
