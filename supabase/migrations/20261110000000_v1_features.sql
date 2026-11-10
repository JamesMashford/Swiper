-- Swiper v1 features: starter flag, name suggestions, rankings and shortlist scores.
-- All functions are SECURITY DEFINER with an empty search_path and callable only by
-- signed-in users. Partner data (swipes, rankings, duels) is used inside the functions
-- but never returned.

-- ---------------------------------------------------------------------------
-- Names: starter flag (select on names is already granted to authenticated)
-- ---------------------------------------------------------------------------
alter table public.names add column if not exists is_starter boolean not null default false;
create index if not exists names_starter_idx on public.names (id) where is_starter;

-- ---------------------------------------------------------------------------
-- suggest_names: next batch of names to swipe on
--
-- * never returns a name the caller already swiped (a partner's dislike does not hide it)
-- * honours the nursery's genders and origins (empty origins = all)
-- * caller has < 15 likes: unswiped starter names in random order, then other unswiped
--   names in random order once the starters run out
-- * otherwise: taste ranked. Every token (tag, origin, gender, syllable count) gets a
--   weight = 3 x (#nursery matches carrying it) + 1 x (caller likes) + 1 x (partner likes)
--   - 1 x (caller dislikes). A candidate scores sum(token weights) / sqrt(#tokens).
--   About 20% of the batch (floor(p_n * 0.2), at least 1 when p_n >= 5) is random picks
--   from the remaining candidates. The batch is shuffled so random picks are interleaved.
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

  select n.id, n.genders, n.origins into v_nursery, v_genders, v_origins
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

-- ---------------------------------------------------------------------------
-- Internal helper: Elo ratings of one member inside a nursery. Not callable by API roles.
-- Start 1000, K = 32, duels replayed in (created_at, id) order, only duels between
-- names that are currently matches of the nursery.
-- ---------------------------------------------------------------------------
create or replace function public.member_elo(p_user uuid, p_nursery uuid)
returns table (name_id bigint, elo double precision)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r jsonb;
  d record;
  v_w double precision;
  v_l double precision;
  v_exp double precision;
begin
  select coalesce(jsonb_object_agg(mt.name_id::text, 1000.0), '{}'::jsonb) into v_r
  from public.matches mt where mt.nursery_id = p_nursery;

  for d in
    select du.winner_name_id as w, du.loser_name_id as l
    from public.duels du
    where du.user_id = p_user and du.nursery_id = p_nursery
      and exists (select 1 from public.matches a
                  where a.nursery_id = p_nursery and a.name_id = du.winner_name_id)
      and exists (select 1 from public.matches b
                  where b.nursery_id = p_nursery and b.name_id = du.loser_name_id)
    order by du.created_at, du.id
  loop
    v_w := (v_r ->> d.w::text)::double precision;
    v_l := (v_r ->> d.l::text)::double precision;
    v_exp := 1.0 / (1.0 + power(10.0, (v_l - v_w) / 400.0));
    v_r := jsonb_set(v_r, array[d.w::text], to_jsonb(v_w + 32 * (1 - v_exp)));
    v_r := jsonb_set(v_r, array[d.l::text], to_jsonb(v_l - 32 * (1 - v_exp)));
  end loop;

  return query
  select e.key::bigint, e.value::text::double precision
  from jsonb_each(v_r) as e;
end;
$$;

-- ---------------------------------------------------------------------------
-- shortlist_scores: the caller's nursery matches with the couple's combined ranking
--
-- Combined ranking, per match name and per member of the nursery:
--   rank_points = (n_ranked - 1 - position) / (n_ranked - 1)   in 0..1 (1 if only one
--                 name is ranked), or 0.5 (neutral) if that member did not rank the name
--   elo_points  = (elo - min elo) / (max elo - min elo) across the nursery's matches,
--                 0.5 for everyone when all Elo ratings are equal
--   member_score = 0.7 * rank_points + 0.3 * elo_points
-- combined_score = average of member_score over the nursery's members (rounded to 4 dp);
-- combined_rank = row number ordered by combined_score desc, then name (1 = best).
-- Only the caller's own position and Elo are returned, never the partner's.
-- ---------------------------------------------------------------------------
create or replace function public.shortlist_scores()
returns table (
  name_id bigint,
  name text,
  gender text,
  meaning text,
  my_position integer,
  my_elo integer,
  combined_score numeric,
  combined_rank integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_nursery uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select m.nursery_id into v_nursery
  from public.nursery_members m where m.user_id = v_user;
  if v_nursery is null then
    return;
  end if;

  return query
  with members as (
    select m.user_id from public.nursery_members m where m.nursery_id = v_nursery
  ),
  mt as (
    select x.name_id from public.matches x where x.nursery_id = v_nursery
  ),
  rk as (
    select r.user_id, r.name_id, r.position,
           count(*) over (partition by r.user_id) as n_ranked
    from public.rankings r
    where r.nursery_id = v_nursery
      and r.user_id in (select user_id from members)
      and r.name_id in (select name_id from mt)
  ),
  elo as (
    select mb.user_id, e.name_id, e.elo
    from members mb, lateral public.member_elo(mb.user_id, v_nursery) e
  ),
  elo_range as (
    select user_id, min(elo) as lo, max(elo) as hi from elo group by user_id
  ),
  per_member as (
    select mb.user_id, mt.name_id,
           0.7 * coalesce(
             case when rk.n_ranked = 1 then 1.0
                  else (rk.n_ranked - 1 - rk.position)::numeric / (rk.n_ranked - 1) end,
             0.5)
           + 0.3 * case when er.hi = er.lo then 0.5
                        else ((el.elo - er.lo) / (er.hi - er.lo))::numeric end as score
    from members mb
    cross join mt
    left join rk on rk.user_id = mb.user_id and rk.name_id = mt.name_id
    left join elo el on el.user_id = mb.user_id and el.name_id = mt.name_id
    left join elo_range er on er.user_id = mb.user_id
  ),
  combined as (
    select pm.name_id, round(avg(pm.score), 4) as score
    from per_member pm group by pm.name_id
  ),
  mine as (
    select r.name_id, r.position from rk r where r.user_id = v_user
  ),
  my_e as (
    select e.name_id, round(e.elo)::int as elo from elo e where e.user_id = v_user
  )
  select nm.id,
         nm.name,
         nm.gender,
         nm.meaning,
         mi.position::integer,
         me.elo,
         c.score,
         (row_number() over (order by c.score desc, nm.name, nm.id))::integer
  from combined c
  join public.names nm on nm.id = c.name_id
  left join mine mi on mi.name_id = c.name_id
  left join my_e me on me.name_id = c.name_id
  order by 8;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.suggest_names(int) from public, anon;
revoke execute on function public.save_ranking(bigint[]) from public, anon;
revoke execute on function public.shortlist_scores() from public, anon;
revoke execute on function public.member_elo(uuid, uuid) from public, anon, authenticated;

grant execute on function public.suggest_names(int) to authenticated;
grant execute on function public.save_ranking(bigint[]) to authenticated;
grant execute on function public.shortlist_scores() to authenticated;
