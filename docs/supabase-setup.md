# Supabase setup (one-off, about 10 minutes, works from a phone browser)

Dashboard labels change over time. If a name below doesn't match, look for the closest one.

1. **Create a project** at supabase.com: New project, pick a name (e.g. `swiper`), set a database password (save it in a password manager), choose the region nearest you. Free tier is enough for v1.
2. **Apply the schema.** Open the SQL Editor, paste the contents of each file in `supabase/migrations/` in filename order, and run them one at a time:
   1. `20261108000000_initial_schema.sql`
   2. `20261108000100_nursery_update_columns.sql`
   3. `20261108000200_table_grants.sql` (newer Supabase projects don't grant table access to signed-in users automatically; without this, every table read fails with "permission denied")
   4. `20261110000000_v1_features.sql` (name suggestions, shortlist ranking, match fixes)
   5. `supabase/seed/names_starter.sql` (305 starter names; safe to run again)
   If the first run complains about the `vector` extension, enable it under Database, Extensions, then run it again.
3. **Email and password sign-in.** Under Authentication, Providers, make sure Email is enabled. For a two-person app, switch off "Confirm email" so sign-up works immediately. Also set the minimum password length to 8 (the app asks for 8, but the server accepted 7 when tested; the setting is in the same Authentication area, often under Policies or Sign In / Providers, and the name may differ).
4. **Copy the project URL and anon key.** Under Project Settings, API. These two values go into the app as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `app/.env.example`). The anon key is designed to be public: row level security protects the data. Never use the `service_role` key in the app.
5. **Check Realtime** (needed for match alerts later). The migration adds `public.matches` to the `supabase_realtime` publication. Under Database, Publications, confirm it is listed.

## Checking it works

- Sign up two accounts in the app, create a nursery with the first, join with the second using the invite code.
- In the SQL Editor, `select * from public.profiles;` should show both people.
