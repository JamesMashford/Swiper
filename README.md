# Swiper

Pair with a partner and find baby names you both love by swiping.

Two expectant parents link accounts with an invite code, swipe on baby names, and see only the names they both like. See [PLAN.md](PLAN.md) for the product plan and [docs/build-contract.md](docs/build-contract.md) for the v1 interfaces and decisions.

## Layout

| Path | Contents |
|---|---|
| `app/` | Mobile-first PWA: React, Vite, TypeScript, Tailwind |
| `app/src/screens/` | Swipe, Matches, Shortlist and Settings screens |
| `app/public/` | PWA icons (`icon.svg` is the source for the PNGs) |
| `supabase/migrations/` | Postgres schema, RLS policies and RPCs |
| `supabase/seed/` | Starter name data |
| `scripts/` | Offline name-data pipeline (`import-ssa.mjs`) |
| `docs/` | Plan, build contract, Supabase setup guide |

## Run the app

```sh
cd app
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

The app boots without Supabase credentials and shows a notice until they are set.

`npm run demo` is a legacy partial demo with an in-browser fake backend. It covers only sign-in and the nursery; it does not support swiping, matches or the shortlist.

## Build and check

```sh
cd app
npm run build    # type check, then production build into app/dist (includes the service worker)
npm run lint
npm run preview  # serve the built app locally
```

## Database setup

Follow [docs/supabase-setup.md](docs/supabase-setup.md) to create a Supabase project and apply the SQL. Run these files in the SQL editor (or with `supabase db push`), in this order:

1. `supabase/migrations/20261108000000_initial_schema.sql`
2. `supabase/migrations/20261108000100_nursery_update_columns.sql`
3. `supabase/migrations/20261108000200_table_grants.sql`
4. `supabase/migrations/20261110000000_v1_features.sql`
5. `supabase/seed/names_starter.sql`

Privacy rule: partners can never read each other's swipes; they only see `matches`.

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `app` (framework preset: Vite).
2. Add two environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key only, never `service_role`).
3. Deploy. `app/vercel.json` rewrites all routes to `index.html`, caches hashed assets as immutable and keeps `index.html` and `sw.js` uncached.

The variables are baked in at build time, so redeploy after changing them. The service worker never caches Supabase API traffic.

On an iPhone, open the deployed site in Safari and use Share, Add to Home Screen to install it.

## Name import

```sh
node scripts/import-ssa.mjs <dir-with-yobYYYY.txt-files> --min 20000
```

Writes `data/names.seed.json` (gitignored). Tagging with Claude is a possible later step; v1 ships a hand-written starter set instead.
