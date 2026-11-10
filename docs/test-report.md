# Swiper test report

Independent test pass on branch `claude/focused-pascal-ytfp0w`, 10 Nov 2026. Tester did not build the app and changed no product file. Everything below was actually run; anything not run is in "Not tested / blocked".

**Headline:** no Critical or High findings. The live project does **not** have migration `20261110000000` or the seed yet, so the real full-stack flow (swipe deck, rankings, shortlist, couple's ranking) could **not** be run against it: that part is **BLOCKED**, not passed. `scripts/e2e/full-flow.mjs` detects this and exits 2; it was dry-run to a full pass against an in-memory fake (proves the script, not the database).

## Summary

| Area | Checks run | Passed | Failed (distinct issues) | Blocked |
|---|---|---|---|---|
| Static review (read all of `app/src/`, all 4 migrations, seed) | build, lint, audit, secrets scan, `.gitignore`, git-history scan, code reading | build, lint (1 allowed warning), audit, no secrets | see findings F1 to F14 and I1 to I8 | |
| Local DB: author's `v1_features_test.sql` (migrations 1-4, before seeding) | 423 assertions | 423 | 0 | |
| Local DB: seed (idempotent re-run, vocab, lengths) | 8 queries | 8 | 0 | |
| Local DB: my adversarial SQL (RLS, grants, anon, cross-nursery, deck logic, Elo, concurrency, user deletion) | about 85 probes | about 73 behaved as intended | 6 findings (F2, F3, F5, F8, F9, F11) | |
| UI shell vs mocked Supabase, 390x844 and 360x640 | 238 checks | 216 | 22 failures = 11 distinct issues x 2 viewports (F4, F6, F7, F10, F12, F13, F14) | |
| axe-core WCAG 2 A/AA + best-practice, 10 screen states | 10 scans | 8 free of serious violations | serious: swipe-card contrast (F12); moderate: landmarks/headings (F14) | |
| Live project: `live1.py` / `live2.py` regression | 28 + 21 | 28 + 21 | 0 | |
| Live project: real-browser pass `live-auth-nursery.mjs` (two contexts) | 20 steps, run twice | 20 on the 2nd run | 1st run: 2 failed (one my own test timing, one real = F6); 2nd run clean | |
| Live project: anon access, rate probe, PWA offline | 3 probes | 3 | invite-code unthrottled (F3) | |
| Real Supabase Realtime websocket delivery | 1 | 1 (overlay in 1.7 s, 2 to 3 frames received) | 0 | |
| Live full flow (`full-flow.mjs`: deck, match overlay, rank, duel, couple's ranking, privacy) | script dry-run vs fake: 24/24 | n/a | n/a | **BLOCKED: database update not applied** |

## Findings, by severity

### Critical / High
None found. I looked specifically for: RLS gaps (every table, cross-nursery, as `anon`), function grants, SQL injection through `join_nursery`, XSS through names, secrets in the repo and its history, and could not break any of them. Evidence is under "What I tried and could not break".

### Medium

**F1. Invite code is a 20-bit secret with no throttling and an oracle.** `20261108000000_initial_schema.sql:238-243, 295-301, 68-69`. Code is `BABY-` plus 4 characters from 32 symbols, 1,048,576 possibilities. `join_nursery` answers "Invite code not found" for a miss and "already has two members" for a full nursery, so it confirms which codes exist. Live probe: 300 `join_nursery` calls from one account in 6.4 s (16 threads, all answered, no 429). A stranger who joins a half-empty nursery can then like every name and learn which ones the real partner liked (they become matches), and also locks the real partner out (nursery full). Expected: a join should not be enumerable. Fix: longer code (8+ chars), one generic error for miss and full, and a small per-user attempt counter (for example a table of failed attempts with a lockout), or expire unused codes.

**F2. Two simultaneous likes can create no match, permanently.** `initial_schema.sql:137-173` (`sync_matches_on_swipe`). Each trigger checks for the partner's like but does not see the partner's uncommitted row. Reproduced: two sessions in overlapping transactions both liked name 10, committed, `swipes` has both likes and `matches` has 0 rows. Nothing repairs it later (the name never returns to either deck). Window is small but real because both partners see the same 32 starters. Verified fix in a scratch DB: add `perform pg_advisory_xact_lock(hashtextextended(v_nursery::text, 0));` after the nursery lookup in the trigger; the same race then yields 1 match.

**F3. `shortlist_scores()` lets each partner compute the other's ranking.** `20261110000000_v1_features.sql:349-371`. The contract says the combined ranking is built "without exposing either partner's individual numbers", but `combined_score` is the exact average of the two members' scores and the caller also receives their own `my_position` and `my_elo`, so `partner_score = 2*combined_score - my_score`. Reproduced: B ranked names 5,4,3,2,1, A ranked 1..5, no duels; A recovered B's rank points `1:0.000, 2:0.250, 3:0.500, 4:0.750, 5:1.000` exactly. With Elo in the mix it is the blended 0.7/0.3 score, still per name. Fix: return only `combined_rank` (and a coarse tier), not `combined_score`, or add rounding/noise; at minimum drop the 4-decimal score.

**F4. Foregrounding the app while offline replaces the whole app with a bare error.** `app/src/App.tsx:48-54`, `app/src/nursery/useNursery.ts:22-27, 49`. Reproduced (mocked, and the same code path): signed in, network drops, app becomes visible again; after about 7 s (postgrest-js retries GETs first) the tab bar, current screen and all state are replaced by the text "TypeError: Failed to fetch" with no Retry button and no Sign out. It recovers only on the next `visibilitychange` once online. This is the normal "open the PWA before the phone has signal" case. Expected: keep the shell, show a banner, offer Retry. Fix: do not put `error` from a background refresh into the render-blocking path (only for the first load), and add a Retry/Sign-out button to the error screen.

### Low

**F5. Unbounded text and an empty gender filter are accepted by the database.** `initial_schema.sql:47` (`genders <@ array[...]` allows `'{}'` and duplicates), no length limits on `nurseries.surname`, `origins`, `profiles.display_name`. Reproduced locally and live: `update nurseries set genders='{}'` succeeds (then `suggest_names` returns nothing, the app shows "You have seen every name" with no hint); 1 MB surname, 1 MB display name and a 10 x 1000-char origins array accepted; live `create_nursery('S' x 100000)` stored 100,000 chars; live signup with a 20,000-char `full_name` stored 20,000 chars in `profiles`. Only a person's own nursery is affected, but it bloats every response. Fix: `check (cardinality(genders) between 1 and 3)`, `char_length(surname) <= 60`, `char_length(display_name) <= 60`, `cardinality(origins) <= 19`.

**F6. Display-name field can be empty if Settings is opened immediately after creating/joining.** `app/src/screens/SettingsScreen.tsx:63` (`useState(me?.display_name ?? '')` runs once) and `useNursery.ts:28-38` (sets `nursery` before `members`). Reproduced with 1.2 s latency on the profile fetch: Settings opened right after "Create nursery" shows an empty Display name and never fills in. Saving then fails with "Your name cannot be empty" or overwrites. Seen once in the live run before I added a wait. Fix: set `nursery` and `members` together before `setLoading(false)`, or key `SettingsScreen` on `me?.display_name`.

**F7. Premature "You have seen every name that fits your filters" on a slow connection.** `app/src/screens/SwipeScreen.tsx:118` (`status === 'empty' || !top`) with `useDeck.ts:106`. Reproduced: with a 2.5 s `suggest_names` response, swiping 12 cards in a row (the 10-card batch runs out before the prefetch lands) flashes the empty state and the advice to widen filters, then the deck reappears by itself. Fix: when `status` is `ready` or `loading` and `!top`, show the skeleton, not the empty state.

**F8. Rank scores can go negative after a match disappears.** `v1_features.sql:337-340` with `rankings` FKs `on delete cascade` (`initial_schema.sql:212, 223-224`). If either partner flips a like to a dislike the match row is deleted, which silently deletes both partners' ranking rows and duels for that name, leaving position gaps; `(n_ranked-1-position)/(n_ranked-1)` then goes below 0 (reproduced: -0.333). Not reachable from the UI today (swiped names never come back), reachable via API. Fix: rank by `row_number() over (partition by user order by position)` instead of raw `position`.

**F9. Stale matches remain when a partner is deleted.** Reproduced locally: after partner B's account was deleted, the 5 matches stayed, and a new person C who joined the nursery saw all 5 matches they never swiped. There is also no in-app way to leave a nursery, delete an account, or change the invite code (nursery members have no delete grant). A mistyped code that happens to match a real half-empty nursery is permanent. Fix: add a `leave_nursery()` RPC that removes the member's matches that depended on them, and a rotate-code RPC.

**F10. Match-alert dialog is not a focus trap.** `app/src/ui/MatchOverlay.tsx:31-36`. It is `role="dialog" aria-modal="true"` and focuses "See matches", but three Tab presses move focus out of the dialog to the page behind it (reproduced). Keyboard and screen-reader users can interact with the swipe screen while the modal is "open". Fix: trap Tab inside the dialog, set the rest of the page `inert`, restore focus on close.

**F11. Several overlays queue up when many matches arrive at once.** `useMatchAlerts.ts` queues one overlay per new match. In the dry run, partner A had to dismiss 4 consecutive overlays after B liked 4 names; the same happens right after joining when past solo likes back-fill many matches. Fix: collapse to "N new matches".

**F12. Accessibility basics on the auth/nursery screens and the swipe card.**
- Inputs on sign-in, sign-up and nursery setup have only a placeholder, no `<label>` (`SignIn.tsx:39-67`, `NurserySetup.tsx:44-66`). axe accepts a placeholder as a name, but the hint disappears once typing starts.
- Touch targets under 44 px: inputs 42 px, "Sign in"/"Create nursery"/"Join nursery" buttons 40 px, and the "New here? Create an account" link 20 px high (`SignIn.tsx:25-26, 73-91`, `NurserySetup.tsx:8-11`). All other screens passed the 44 px check.
- Focus indication on those inputs, and on Settings' surname and display-name inputs, is only a 1 px border colour change (`outline-none` plus `focus:border-neutral-900`; `SettingsScreen.tsx:7` also sets `outline-none` before `focus-visible:outline-2`, which Tailwind 4 cancels).
- The surname on every swipe card is `text-neutral-400` on white: contrast 2.58:1, axe "serious" (`SwipeCard.tsx:92`); the small "Meaning" label uses the same colour.
- `TabBar.tsx:23` puts `aria-label="new"` on an empty `<span>` with no role, which screen readers ignore, so the unseen-match badge is invisible to them.

**F13. Server accepts passwords the UI rejects.** The UI requires 8 characters (`SignIn.tsx:63`), but the live Auth server accepted a 7-character password through the API. Set the minimum length in Supabase Auth settings to 8 as well.

**F14. Document structure.** No `<main>` landmark once signed in (`App.tsx:91-92`), no `<h1>` on the Swipe screen, and an `<h3>` directly after the `<h1>` in the Head to head tab (`DuelTab.tsx:151`). axe: moderate. `role="tabpanel"` has no `aria-labelledby` and tabs have no `aria-controls` (`ShortlistScreen.tsx:61-78`).

### Info
- **I1.** Raw library text reaches users: "Could not save that swipe: TypeError: Failed to fetch".
- **I2.** `suggest_names` uses the partner's likes to rank the caller's deck (by design in the plan), so a user can infer the partner's taste from what they are shown. Not a leak of individual swipes.
- **I3.** With reduced motion on, the card cannot be dragged at all (`SwipeCard.tsx:60`); buttons and arrow keys remain. Acceptable, but touch users with that setting lose the gesture.
- **I4.** The 4 live `ZZTest One..Four` rows in `names` are not starters, so once the seed is applied they will be served as ordinary cards after the 32 starters run out. Delete them before real use.
- **I5.** `vercel.json` sets `nosniff` and a referrer policy but no `Content-Security-Policy` and no `frame-ancestors`/`X-Frame-Options` (clickjacking). Low risk here, easy to add.
- **I6.** Single JS bundle: 642 kB (191 kB gzip), Vite warns above 500 kB. Fine for v1.
- **I7.** `npm audit`: 0 vulnerabilities in runtime dependencies; 6 in dev tooling (4 moderate, 2 low, all via `vite-plugin-pwa` > `workbox` > `glob`/`minimatch`/`deepmerge`, build time only). No high or critical.
- **I8.** `is_nursery_member(uuid)` is executable by `anon`; it can only ever report on the caller, so harmless.

## What I tried and could not break (so you know it was looked at)
- **RLS and grants (local DB emulating Supabase default function privileges, plus live anon probes):** `anon` is denied on every table and on `suggest_names`, `save_ranking`, `shortlist_scores`, `create_nursery`, `join_nursery` (live: HTTP 42501 on all). `member_elo` and `generate_invite_code` are not callable by `authenticated`. A user cannot read another nursery's matches, members, profiles, rankings or duels, cannot read the partner's swipes, cannot insert swipes/duels/rankings as someone else or into another nursery, cannot update `invite_code` or `created_by`, cannot write `matches`, `names` or `nursery_members`.
- **`save_ranking`:** foreign-nursery ids, mixed ids, duplicates, nulls and nonexistent ids all raise; empty array clears; a user outside any nursery gets an error.
- **`suggest_names`:** first batch is all starters, 32 requested returns exactly the 32 starters then tops up with others, no duplicates, never returns a swiped name, filters honoured (0 violations in 100 draws), partner dislikes do not hide a name, taste mode returns only unswiped names with exact counts for p_n 4, 5, 10, exhausted deck returns 0, `p_n` null/0/negative handled, 4 ms per call on 305 names. Join race on a nursery with one free seat: exactly one of two simultaneous joins wins.
- **Elo and duels:** 1016/984 after one duel, `winner = loser` rejected, 20,000 duels saturate without NaN and `shortlist_scores` still answers in 99 ms.
- **Injection and XSS:** `' or 1=1 --` as invite code is treated as data. Names, surnames and display names containing `<script>`, `<img onerror>`, quotes, accents and 200 unbroken characters render as text in every screen, never executed, no horizontal scroll, including on the partner's screen.
- **Secrets:** no key, token or `.env` in `git ls-files` or in `git log -p` (searched for `sb_secret`, `service_role` values, JWTs, `postgres://` URLs, `ghp_`). `.env.local` is ignored by both `.gitignore` files. Only the public anon key exists in the built bundle, as expected.
- **Auth in a real browser (live):** wrong password gives "Invalid login credentials"; duplicate sign-up gives "User already registered"; 7-character password blocked by the browser before any request; sign out clears the stored token, Back does not reveal the shell, and signing in as the other person shows none of the previous person's data.
- **Touch:** CDP touch events (not mouse) swipe right to like and left to dislike at 160 px, 40 px snaps back, a vertical gesture does not swipe, touch-dragging a Rank handle reorders and saves.
- **Offline:** a failed swipe puts the card back with an error and the same card saves after reconnect; Matches keeps its list, shows an error with Retry and recovers; the PWA shell loads from the service worker with the network off.
- **Persistence (live, two contexts):** surname, display name and filters persist across reload and are visible to the partner.
- **Real Realtime:** with both people on the Swipe tab, a match created through the API produced the overlay in 1.7 s with websocket frames received, i.e. the Realtime path works, not just the 20 s polling fallback.

## Not tested / blocked
- **BLOCKED: database update not applied.** At test time `suggest_names`, `save_ranking`, `shortlist_scores` returned PGRST202 and `names.is_starter` did not exist; `names` held only the 4 ZZTest rows. So the live deck, live rankings/duels/shortlist, the match overlay driven by real swipes, and the live privacy assertions in `full-flow.mjs` were not run. The same logic was exercised only on a local Postgres 16 with migrations 1-4 and the seed (DB behaviour) and against a mocked API (UI behaviour). Re-run `node scripts/e2e/full-flow.mjs` once the SQL is applied; it should stop being exit code 2 and run all 24 steps.
- The `vector` extension and `names.embedding`: the local DB used `real[]` instead of `vector(384)` (sed swap), so the actual `create extension vector` line and real pgvector were not run. The migrations do not use vector operators in v1.
- Real iPhone install ("Add to Home Screen"), iOS safe areas and the iOS standalone behaviour: not tested. Only headless Chromium (390x844, 360x640, touch emulation) was used. No Safari/WebKit or Firefox.
- Load or concurrency beyond the two-session races above; Supabase free-tier limits; websocket behaviour under flaky mobile networks.
- Email confirmation ON path (it is off on the project; the UI message for it was not exercised against a real project).
- Screen reader behaviour (VoiceOver/TalkBack): only axe-core and DOM inspection.
- Web push (not in v1 by contract).
- The in-app flows of "Check" (Settings partner refresh) and clipboard copy fallback were not exercised.

## Scripts delivered (all in `scripts/e2e/`)
- `full-flow.mjs`: live end-to-end, two contexts. Exits 2 with a clear message when `suggest_names` or the starter seed is missing. `MOCK=1` runs it against the fake.
- `ui-shell.mjs` + `mock-supabase.mjs`: the 238-check UI suite against a fake Supabase (`ONLY="swipe 390"` runs one scenario).
- `live-auth-nursery.mjs`: live auth/nursery/Realtime pass that works today.
- `axe-audit.mjs`: axe-core over all screens (needs `AXE_PATH`).

## Test accounts created on the live project
All `@example.com`, all test data, none deleted (the anon key cannot delete users).

- Probes: `swiper.test.probe.1490219830`, `swiper.test.probe.166027299`, `swiper.test.probe.i3ka9g`
- `live1.py` (aborted first run): `swiper.test.a.b31df6`, `.b.b31df6`, `.c.b31df6`; second run: `swiper.test.a.a87894`, `.b.a87894`, `.c.a87894`
- `live2.py`: `swiper.test.a.ea9fbc`, `.b.ea9fbc`, `.c.ea9fbc`, `.d.ea9fbc`
- Browser pass run 1: `swiper.test.uia.lmpps3`, `.uib.lmpps3`, `.pw7.lmpps3`, `.long.lmpps3`, `.bigs.lmpps3`
- Browser pass run 2: `swiper.test.uia.26clta`, `.uib.26clta`, `.pw7.26clta`, `.long.26clta`, `.bigs.26clta`
- Other probes: `swiper.test.hn.0e6095` (hostile name via API), `swiper.test.names.3deb11`, `swiper.test.rate.d0252b` (created a nursery with surname "Rate" and sent 300 join attempts)
- (every address above is `@example.com`; the mock-mode runs of `full-flow.mjs` created nothing live)

Test data left on the live project: nurseries created by these accounts (surnames including a 100,000-character one and hostile-string ones), one real-Realtime match on `ZZTest One` for the `uia`/`uib` pairs, and swipes/matches from `live1.py`/`live2.py`. All belong to the accounts above.
