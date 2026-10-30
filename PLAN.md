# Swiper: baby name app plan (personal v1)

Two expectant parents link accounts, swipe on baby names, and get suggestions weighted toward names they both like.

## Decisions

| Area | Decision |
|---|---|
| Platform | Mobile-first PWA: React + Vite + TypeScript (not React Native Web) |
| UI | Tailwind + shadcn/ui, Framer Motion for swipe cards; visual theme decided later |
| Backend | Supabase: Auth, Postgres + pgvector, Realtime, Edge Functions |
| Hosting | Vercel |
| Auth | Magic link + Google + Apple (Apple needs a paid developer account; can be added later) |
| Linking | Invite code (e.g. `BABY-7K2Q`) creating a shared "nursery" |
| Rating | Tinder-style swipe: right = like, left = dislike |
| Visibility | Partners only ever see mutual matches |
| Dislikes | Hard veto: one partner's dislike hides the name from both |
| Filters | Gender (boy/girl/neutral), surname preview, origin/culture |
| Name data | Public datasets (US SSA, UK ONS), enriched once offline with Claude |
| Suggestions | Hybrid: pgvector embeddings + feature tags, pre-generated blurbs, no live LLM calls |
| Weighting v1 | 3x mutual likes, 1x own likes, 1x partner's likes, minus dislikes; adaptive weighting later |
| Cold start | Diverse starter deck of about 30 names |
| Solo mode | Swipe before partner joins; past likes are compared on linking |
| Matches | Ranked shortlist, head-to-head, real-time match alert |
| Scope | Personal project, free tiers, no monetisation |

## Data model

| Table | Purpose |
|---|---|
| `profiles` | Display name, linked to the Supabase login |
| `nurseries` | Shared space: invite code, surname, gender filter, origin filters |
| `nursery_members` | Links people to a nursery (max 2); RLS keeps access inside the nursery |
| `names` | Name, gender, origins, meaning, style tags, popularity, blurb, `embedding vector(384)` |
| `swipes` | One row per person per name: like or dislike |
| `matches` | Created by a trigger when both partners like a name; watched by Realtime |
| `rankings` | Each partner's ordering of the shortlist |
| `duels` | Head-to-head results feeding an Elo score per match |

**Privacy:** RLS prevents either partner reading the other's swipes. Comparisons run in `SECURITY DEFINER` functions, so partners only see `matches`.

## Name data pipeline (one-off, offline)

1. Import US SSA and UK ONS name data; keep names above a minimum popularity (about 20-40k).
2. Use Claude (batch) to tag each name: origin, meaning, style tags, syllables, one-line blurb.
3. Embed a short text per name with Supabase `gte-small`; store in `names.embedding`.

## Suggestion engine: `suggest_names(user, n)`

1. Taste profile = 3 x mean(mutual likes) + 1 x mean(own likes) + 1 x mean(partner likes) - weighted share of dislikes.
2. Candidates: apply gender/origin filters; exclude already-swiped names and anything the partner disliked.
3. Rank by pgvector distance (`<=>`).
4. About 20% of each batch is random, so tastes can shift.
5. Fewer than about 15 likes: serve the fixed diverse starter deck.
6. Later: adaptive weighting based on the couple's match count.

## Screens

Sign-in, create/join nursery by code, filters and surname, Swipe (card shows full name with surname, meaning, blurb), Matches (celebration on new match), Shortlist (drag-to-rank and head-to-head tabs).

## Build phases

1. Foundation: Vite PWA, Supabase project, login, nurseries and invite codes.
2. Data: import script, Claude tagging, embeddings.
3. Core loop: swipe deck, `suggest_names`, match trigger, matches list.
4. Realtime: in-app match alerts, then web push (iOS needs the app on the home screen).
5. Shortlist: drag-to-rank, head-to-head with Elo, combined ranking.
6. Polish: visual theme, adaptive weighting.

## Open caveats

- Apple sign-in costs $99/year; start with magic link + Google if preferred.
- Tagging about 30k names with Claude is a one-off cost of a few dollars using batch requests.
