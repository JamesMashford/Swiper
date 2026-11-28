-- Market and Portuguese origin (issue #6, part of #4). See GLOSSARY.md (Market, Origin).
--
-- * Origin: "Portuguese" joins the origin list. Origins are free text in the database, but
--   the nurseries_origins_count limit (19) would stop a nursery picking all 20, so it is
--   raised to 20.
-- * Market: public.markets lists the five markets. public.name_market_popularity stores a
--   popularity per (name, market). A name is "in" a market when it has a row there.
--   names.popularity is untouched and keeps working until the import replaces it.
-- * nurseries.markets: optional filter, empty = all markets (the default).
-- * suggest_names applies it, in the starter deck as well as the taste-ranked deck.
--
-- A Name that has no market rows at all (every current name: no per-market data exists yet)
-- passes any market filter, so a nursery that picks a market still gets a deck until the
-- import fills the table. A Name that has market rows, none of them in the nursery's
-- markets, is never served to that nursery.

-- ---------------------------------------------------------------------------
-- Origin limit: 19 origins before, 20 now that Portuguese exists
-- ---------------------------------------------------------------------------
alter table public.nurseries drop constraint if exists nurseries_origins_count;
alter table public.nurseries add constraint nurseries_origins_count
  check (cardinality(origins) <= 20);

-- ---------------------------------------------------------------------------
-- Markets
-- ---------------------------------------------------------------------------
create table public.markets (
  code text primary key,
  position smallint not null unique
);
insert into public.markets (code, position) values
  ('UK', 1), ('US', 2), ('Scandinavia', 3), ('Italy', 4), ('Brazil', 5);

create table public.name_market_popularity (
  name_id bigint not null references public.names (id) on delete cascade,
  market text not null references public.markets (code),
  popularity integer not null check (popularity > 0),
  primary key (name_id, market)
);
create index name_market_popularity_market_idx on public.name_market_popularity (market, name_id);

alter table public.markets enable row level security;
alter table public.name_market_popularity enable row level security;
create policy markets_select on public.markets for select to authenticated using (true);
create policy name_market_popularity_select on public.name_market_popularity
  for select to authenticated using (true);
-- Read-only for the API: rows are loaded by the import, not by users.
grant select on public.markets to authenticated;
grant select on public.name_market_popularity to authenticated;

-- ---------------------------------------------------------------------------
-- Nursery filter. Checks mirror the other filters: a length limit, plus valid values.
-- (A CHECK cannot read another table, so the values are listed here; the test compares
-- them with public.markets so the two cannot drift apart unnoticed.)
-- ---------------------------------------------------------------------------
alter table public.nurseries add column markets text[] not null default '{}';
alter table public.nurseries add constraint nurseries_markets_count
  check (cardinality(markets) <= 5);
alter table public.nurseries add constraint nurseries_markets_valid
  check (markets <@ array['UK', 'US', 'Scandinavia', 'Italy', 'Brazil']);

-- Members may edit settings only, not the invite code, owner or id (see migration ...100).
grant update (markets) on public.nurseries to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helper: may this name be served to a nursery restricted to these markets?
-- True when the name has no market data at all, or is popular in at least one of them.
-- ---------------------------------------------------------------------------
create function public.name_allowed_in_markets(p_name_id bigint, p_markets text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
           select 1 from public.name_market_popularity p where p.name_id = p_name_id
         )
      or exists (
           select 1 from public.name_market_popularity p
           where p.name_id = p_name_id and p.market = any (p_markets)
         );
$$;
revoke execute on function public.name_allowed_in_markets(bigint, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- suggest_names: unchanged apart from the market filter (copied from 20261110000000, with
-- v_markets added and applied to both candidate queries). Same signature and columns.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_names(p_n int default 10)
returns table (
  id bigint,
  name text,
  gender text,
  origins text[],
  meaning text,
  style_tags text[],
  syllables smallint,
  popularity integer,
  blurb text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_nursery uuid;
  v_genders text[];
  v_origins text[];
  v_markets text[];
  v_likes bigint;
  v_n int := greatest(coalesce(p_n, 10), 0);
  v_random int;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_n = 0 then
    return;
  end if;

  select n.id, n.genders, n.origins, n.markets into v_nursery, v_genders, v_origins, v_markets
  from public.nursery_members m
  join public.nurseries n on n.id = m.nursery_id
  where m.user_id = v_user;

  if v_nursery is null then
    return;
  end if;

  select count(*) into v_likes from public.swipes s where s.user_id = v_user and s.liked;

  if v_likes < 15 then
    -- Starter deck: starters first (random), then everything else (random).
    return query
    select nm.id, nm.name, nm.gender, nm.origins, nm.meaning, nm.style_tags,
           nm.syllables, nm.popularity, nm.blurb
    from public.names nm
    where nm.gender = any (v_genders)
      and (cardinality(v_origins) = 0 or nm.origins && v_origins)
      and (cardinality(v_markets) = 0 or public.name_allowed_in_markets(nm.id, v_markets))
      and not exists (
        select 1 from public.swipes s where s.user_id = v_user and s.name_id = nm.id
      )
    order by nm.is_starter desc, random()
    limit v_n;
    return;
  end if;

  v_random := case when v_n >= 5 then greatest(1, floor(v_n * 0.2)::int) else 0 end;

  return query
  with partner as (
    select m.user_id
    from public.nursery_members m
    where m.nursery_id = v_nursery and m.user_id <> v_user
  ),
  -- Signal names with weights: matches 3x, own likes 1x, partner likes 1x, own dislikes -1x.
  sig as (
    select mt.name_id, 3 as w from public.matches mt where mt.nursery_id = v_nursery
    union all
    select s.name_id, case when s.liked then 1 else -1 end
    from public.swipes s where s.user_id = v_user
    union all
    select s.name_id, 1
    from public.swipes s join partner p on p.user_id = s.user_id
    where s.liked
  ),
  sigw as (
    select name_id, sum(w) as w from sig group by name_id
  ),
  sig_tok as (
    select 'g:' || nm.gender as tok, sw.w from sigw sw join public.names nm on nm.id = sw.name_id
    union all
    select 's:' || nm.syllables::text, sw.w
    from sigw sw join public.names nm on nm.id = sw.name_id where nm.syllables is not null
    union all
    select 't:' || t, sw.w
    from sigw sw join public.names nm on nm.id = sw.name_id, unnest(nm.style_tags) as t
    union all
    select 'o:' || o, sw.w
    from sigw sw join public.names nm on nm.id = sw.name_id, unnest(nm.origins) as o
  ),
  profile as (
    select tok, sum(w)::numeric as w from sig_tok group by tok
  ),
  cand as (
    select nm.id
    from public.names nm
    where nm.gender = any (v_genders)
      and (cardinality(v_origins) = 0 or nm.origins && v_origins)
      and (cardinality(v_markets) = 0 or public.name_allowed_in_markets(nm.id, v_markets))
      and not exists (
        select 1 from public.swipes s where s.user_id = v_user and s.name_id = nm.id
      )
  ),
  cand_tok as (
    select c.id, 'g:' || nm.gender as tok from cand c join public.names nm on nm.id = c.id
    union all
    select c.id, 's:' || nm.syllables::text
    from cand c join public.names nm on nm.id = c.id where nm.syllables is not null
    union all
    select c.id, 't:' || t
    from cand c join public.names nm on nm.id = c.id, unnest(nm.style_tags) as t
    union all
    select c.id, 'o:' || o
    from cand c join public.names nm on nm.id = c.id, unnest(nm.origins) as o
  ),
  scored as (
    select c.id,
           coalesce(sum(p.w), 0) / sqrt(greatest(count(*), 1)) as score
    from cand_tok c
    left join profile p on p.tok = c.tok
    group by c.id
  ),
  ranked as (
    select sc.id,
           row_number() over (order by sc.score desc, random()) as rn
    from scored sc
  ),
  taste as (
    select r.id from ranked r where r.rn <= v_n - v_random
  ),
  rnd as (
    select r.id from ranked r
    where r.rn > v_n - v_random
    order by random()
    limit v_random
  ),
  picked as (
    select t.id from taste t
    union
    select r.id from rnd r
  )
  select nm.id, nm.name, nm.gender, nm.origins, nm.meaning, nm.style_tags,
         nm.syllables, nm.popularity, nm.blurb
  from picked pk
  join public.names nm on nm.id = pk.id
  order by random()
  limit v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_ranking: replace the caller's ranking for their nursery (index 0 = favourite)
-- ---------------------------------------------------------------------------
create or replace function public.save_ranking(p_name_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_nursery uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_name_ids is null then
    raise exception 'Ranking is required' using errcode = '22023';
  end if;

  select m.nursery_id into v_nursery
  from public.nursery_members m where m.user_id = v_user;
  if v_nursery is null then
    raise exception 'You are not in a nursery' using errcode = 'P0001';
  end if;

  if array_position(p_name_ids, null) is not null
     or (select count(distinct x) from unnest(p_name_ids) as x) <> cardinality(p_name_ids) then
    raise exception 'Ranking contains duplicate or empty ids' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_name_ids) as x
    where not exists (
      select 1 from public.matches mt where mt.nursery_id = v_nursery and mt.name_id = x
    )
  ) then
    raise exception 'Ranking contains names that are not matches' using errcode = '22023';
  end if;

  delete from public.rankings r where r.nursery_id = v_nursery and r.user_id = v_user;

  insert into public.rankings (nursery_id, user_id, name_id, position)
  select v_nursery, v_user, x.id, (x.ord - 1)::int
  from unnest(p_name_ids) with ordinality as x (id, ord);
end;
$$;
revoke execute on function public.suggest_names(int) from public, anon;
grant execute on function public.suggest_names(int) to authenticated;
