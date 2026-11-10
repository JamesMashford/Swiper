# Build contract (v1 complete build)

Shared agreements so several people can build in parallel. `PLAN.md` is the product plan; this file fixes the interfaces. If something here conflicts with `PLAN.md`, this file wins (it records later decisions).

## Decisions that differ from or refine PLAN.md
- Dislikes are recorded per person and never hide a name from the partner. A match needs both partners to like the name. Either partner can change their swipe later (upsert on `swipes`).
- No embeddings in v1 (the model cannot be downloaded in the build environment). "Taste" similarity uses `style_tags`, `origins`, `gender`, `syllables` overlap computed in SQL. `names.embedding` stays null; pgvector can be added later.
- No web push in v1. Match alerts are in-app, via Supabase Realtime plus a polling fallback.
- Name data is a hand-written starter set (about 300 names), not full SSA/ONS data. `popularity` is a rough 1 to 100 relative score, not a birth count.
- Demo mode (`VITE_MOCK`) is legacy and covers only sign-in and nursery. Do not extend it.

## Database (already applied on the live project: migrations 20261108000000, ...100, ...200)
Tables: `profiles`, `nurseries(id, invite_code, surname, genders text[], origins text[])`, `nursery_members`, `names`, `swipes(user_id, name_id, liked)`, `matches(nursery_id, name_id, created_at)`, `rankings(nursery_id, user_id, name_id, position)`, `duels(id, nursery_id, user_id, winner_name_id, loser_name_id, created_at)`.
Row level security: a person reads only their own `swipes`, `rankings`, `duels`. Members read their nursery's `matches`. Signed-in users read all `names`. `matches` is written only by triggers.
Swipe with: `supabase.from('swipes').upsert({ name_id, liked }, { onConflict: 'user_id,name_id' })` (`user_id` defaults to `auth.uid()`).

## New in migration 20261110000000_v1_features.sql (written by the database task)
All functions are `security definer`, `set search_path = ''`, callable only by `authenticated`.

- `names.is_starter boolean not null default false`.
- `public.suggest_names(p_n int default 10)` returns `table(id bigint, name text, gender text, origins text[], meaning text, style_tags text[], syllables smallint, popularity integer, blurb text)`.
  Uses `auth.uid()` and the caller's nursery. Never returns names the caller already swiped. Applies the nursery's `genders` and `origins` filters (empty `origins` means all). If the caller has fewer than 15 likes, serve unswiped starter names (`is_starter`) in random order, topping up with other unswiped names if the starters run out. Otherwise rank by taste: tag, origin, gender and syllable overlap with names weighted 3x for matches, 1x for the caller's own likes, 1x for the partner's likes, minus the same for the caller's dislikes; roughly 20% of each batch is random. A name the partner disliked may still be returned. Returns at most `p_n` rows; empty set when the deck is exhausted.
- `public.save_ranking(p_name_ids bigint[])` returns void. Replaces the caller's ranking for their nursery with exactly this order (position 0 = favourite). Ids must be current matches of the caller's nursery, else raise.
- `public.shortlist_scores()` returns `table(name_id bigint, name text, gender text, meaning text, my_position integer, my_elo integer, combined_rank integer)` for the caller's nursery matches. `my_position` is null if the caller has not ranked it (otherwise 0-based position among the caller's ranked matches, gap-free). `my_elo` is the caller's own Elo (start 1000, K=32, from the caller's `duels` in `created_at` order). `combined_rank` 1 = best for the couple, built from both partners' rankings and Elo. There is deliberately NO combined numeric score column: a partner could subtract their own numbers to recover the other's ranking (test finding F3).
- `public.leave_nursery()` returns void: the caller leaves their nursery. A trigger on `nursery_members` delete removes all `matches` of that nursery (cascading rankings and duels) so a later joiner is compared fresh against the remaining member, and deletes the nursery when it has no members left.
- `public.rotate_invite_code()` returns text: gives the caller's nursery a new invite code and returns it (use if a code leaked).
- `public.join_nursery(p_code text)` now returns `jsonb` and does NOT raise for a wrong code, a full nursery or a lockout (a raise would roll back the failure record). Success: `{"ok": true, "nursery_id": "<uuid>"}`. Failure: `{"ok": false, "message": "<text>"}`, where the message is `That invite code did not work. Check it, or ask your partner for a new one.` for both a wrong code and a full nursery, or `Too many attempts. Try again in a few minutes.` after 10 failed attempts by one user in 15 minutes. It still raises (P0001 / 28000) only for "already in a nursery" and "not signed in". Codes are matched case-insensitively with whitespace trimmed. New invite codes are `BABY-` plus 8 characters (older 4-character codes keep working). `create_nursery` still returns the nursery row.
- Text limits (enforced by database checks): surname and display name at most 60 characters, origins at most 19 items, genders between 1 and 3 items. The UI must set `maxLength={60}` on those inputs.
- Duels are plain inserts: `supabase.from('duels').insert({ nursery_id, winner_name_id, loser_name_id })`.
- Realtime: `public.matches` is in the `supabase_realtime` publication. Subscribe to `postgres_changes` `INSERT` on `matches` filtered `nursery_id=eq.<id>`.

## Starter name data contract
Columns: `name`, `gender` (`boy`|`girl`|`neutral`), `origins` (values from the list below), `meaning` (one short plain sentence, no invented etymology: if unsure say "Meaning uncertain"), `style_tags` (values from the list below), `syllables`, `popularity` (1 to 100), `blurb` (one friendly line, max 90 characters), `is_starter` (about 30 names spread across genders, origins and styles).
Origins: English, Irish, Scottish, Welsh, French, Spanish, Italian, German, Scandinavian, Greek, Latin, Hebrew, Arabic, Indian, Japanese, African, Slavic, Celtic, Other.
Style tags: classic, modern, vintage, nature, short, long, strong, soft, royal, literary, biblical, mythological, unisex-feel, playful, elegant.

## Front end
- Stack: React 19, Vite, TypeScript, Tailwind 4 (`@import "tailwindcss"`), framer-motion, `@supabase/supabase-js`. Mobile first (390px wide), min 44px touch targets, no horizontal scroll, visible focus states, light theme only for v1.
- Shared types and constants: `app/src/lib/types.ts`. Do not change them without need; additions are fine.
- The shell (`app/src/App.tsx`) renders four tabs. Each screen is `app/src/screens/<Name>Screen.tsx` with a default export taking `ScreenProps` (see types.ts). Screens fetch their own data with `supabase`. A screen is mounted only while its tab is active.
- File ownership while building in parallel (do not edit other tasks' files):
  - swipe task: `src/screens/SwipeScreen.tsx`, `src/swipe/**`, `src/realtime/**`, `src/App.tsx`, `src/ui/**`
  - shortlist task: `src/screens/MatchesScreen.tsx`, `src/screens/ShortlistScreen.tsx`, `src/shortlist/**`
  - settings task: `src/screens/SettingsScreen.tsx`, `src/nursery/**`, `public/**`, `index.html`, `vite.config.ts`, `vercel.json`, `README.md`
  - database task: `supabase/migrations/20261110*`, nothing else
  - data task: `supabase/seed/**`, nothing else
- Commands in `app/`: `npm run build` (type checks then builds) and `npm run lint` must pass. The only lint warning allowed is the existing `set-state-in-effect` one in `useNursery.ts`.

## Definition of done for every task
Works as specified, no console errors, build and lint pass (front end), tested as described in the task, and a short honest report of what was and was not verified.
