-- Couples simulation against public.suggest_names. Driven by scripts/simulate-couples.sh.
-- Everything runs inside one transaction that is rolled back, so the database is left untouched.
-- psql variables: couples, overlaps, like_rate, noise, seed, genders, variants, batch, max_swipes
\set ON_ERROR_STOP on
\pset footer off
begin;
set local client_min_messages = warning;

select setseed(:'seed'::float8);
select set_config('sim.couples', :'couples', true), set_config('sim.overlaps', :'overlaps', true),
       set_config('sim.like_rate', :'like_rate', true), set_config('sim.noise', :'noise', true),
       set_config('sim.genders', :'genders', true), set_config('sim.variants', :'variants', true),
       set_config('sim.batch', :'batch', true), set_config('sim.max_swipes', :'max_swipes', true) \gset

-- Control deck: unswiped names in random order, no taste ranking at all.
create function pg_temp.sim_random_deck(p_n int) returns table (id bigint) language sql as $$
  select nm.id from public.names nm
  join (select n.genders from public.nursery_members m join public.nurseries n on n.id = m.nursery_id
        where m.user_id = auth.uid()) q on nm.gender = any (q.genders)
  where not exists (select 1 from public.swipes s where s.user_id = auth.uid() and s.name_id = nm.id)
  order by random() limit p_n $$;

create temp table sim_taste (ov numeric, couple int, partner int, name_id bigint, likes boolean);
create temp table sim_res (ov numeric, variant text, couple int, swipes int, first_match int,
  m50 int, m100 int, m200 int, matches int, ceiling int, dry_a int, dry_b int, dup_offers int,
  offered_a int, offered_b int);

create function pg_temp.norm() returns float8 language sql volatile as
$$ select sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) $$;

-- Taste model. Each partner has a random weight per token (style tag, origin, syllables, gender).
-- Partner B's weights = overlap * A's + sqrt(1 - overlap^2) * independent, so overlap 0 is unrelated
-- taste and 1 is the same taste. A name's appeal = mean token weight + noise; a partner likes
-- the top like_rate share of the names allowed by the nursery's gender filter.
create function pg_temp.make_taste(p_ov numeric, p_couple int) returns void language plpgsql as $$
declare
  v_genders text[] := string_to_array(current_setting('sim.genders'), ',');
  v_rate float8 := current_setting('sim.like_rate')::float8;
  v_noise float8 := current_setting('sim.noise')::float8;
begin
  create temp table if not exists sim_w (tok text primary key, wa float8, wb float8) on commit drop;
  truncate sim_w;
  insert into sim_w
  select tok, a, p_ov::float8 * a + sqrt(1 - p_ov::float8 ^ 2) * pg_temp.norm()
  from (select tok, pg_temp.norm() as a from (
          select distinct 'g:' || gender as tok from public.names
          union select distinct 's:' || syllables from public.names where syllables is not null
          union select distinct 't:' || t from public.names, unnest(style_tags) t
          union select distinct 'o:' || o from public.names, unnest(origins) o) x) y;
  create temp table if not exists sim_lat (partner int, name_id bigint, lat float8) on commit drop;
  truncate sim_lat;
  insert into sim_lat
  select pr.partner, t.id,
         avg(case pr.partner when 1 then w.wa else w.wb end) + v_noise * pg_temp.norm()
  from (select nm.id, 'g:' || nm.gender as tok from public.names nm where nm.gender = any (v_genders)
        union all select nm.id, 's:' || nm.syllables from public.names nm where nm.gender = any (v_genders) and nm.syllables is not null
        union all select nm.id, 't:' || x from public.names nm, unnest(nm.style_tags) x where nm.gender = any (v_genders)
        union all select nm.id, 'o:' || x from public.names nm, unnest(nm.origins) x where nm.gender = any (v_genders)) t
  join sim_w w on w.tok = t.tok
  cross join (values (1), (2)) pr (partner)
  group by pr.partner, t.id;
  insert into sim_taste
  select p_ov, p_couple, l.partner, l.name_id,
         l.lat >= (select percentile_cont(1 - v_rate) within group (order by l2.lat) from sim_lat l2 where l2.partner = l.partner)
  from sim_lat l;
end $$;

create function pg_temp.run_couple(p_ov numeric, p_variant text, p_fn text, p_couple int) returns void language plpgsql as $$
declare
  v_genders text[] := string_to_array(current_setting('sim.genders'), ',');
  v_batch int := current_setting('sim.batch')::int;
  v_max int := current_setting('sim.max_swipes')::int;
  v_nursery uuid := gen_random_uuid();
  v_u uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  v_done boolean[] := array[false, false];
  v_dry int[] := array[null, null];
  v_n int[] := array[0, 0];
  v_total int := 0;
  v_first int; v_m50 int; v_m100 int; v_m200 int;
  v_ids bigint[]; v_id bigint; p int; v_like boolean; v_dups int;
begin
  insert into auth.users (id, email) values (v_u[1], 'sim-a-' || v_u[1] || '@sim.local'), (v_u[2], 'sim-b-' || v_u[2] || '@sim.local');
  insert into public.nurseries (id, invite_code, genders, created_by) values (v_nursery, 'SIM-' || v_nursery, v_genders, v_u[1]);
  insert into public.nursery_members (nursery_id, user_id) values (v_nursery, v_u[1]), (v_nursery, v_u[2]);
  create temp table if not exists sim_offered (partner int, name_id bigint) on commit drop;
  truncate sim_offered;

  while not (v_done[1] and v_done[2]) and v_total < v_max loop
    for p in 1..2 loop
      continue when v_done[p];
      perform set_config('request.jwt.claim.sub', v_u[p]::text, true);
      execute format('select coalesce(array_agg(id), ''{}'') from %s($1)', p_fn) into v_ids using v_batch;
      if cardinality(v_ids) = 0 then v_done[p] := true; v_dry[p] := v_n[p]; continue; end if;
      foreach v_id in array v_ids loop
        insert into sim_offered values (p, v_id);
        select likes into v_like from sim_taste where ov = p_ov and couple = p_couple and partner = p and name_id = v_id;
        insert into public.swipes (user_id, name_id, liked) values (v_u[p], v_id, coalesce(v_like, false));
        v_n[p] := v_n[p] + 1; v_total := v_total + 1;
        if v_first is null and exists (select 1 from public.matches where nursery_id = v_nursery) then v_first := v_total; end if;
        if v_total = 50 then select count(*) into v_m50 from public.matches where nursery_id = v_nursery; end if;
        if v_total = 100 then select count(*) into v_m100 from public.matches where nursery_id = v_nursery; end if;
        if v_total = 200 then select count(*) into v_m200 from public.matches where nursery_id = v_nursery; end if;
      end loop;
    end loop;
  end loop;

  select count(*) - count(distinct (partner, name_id)) into v_dups from sim_offered;
  insert into sim_res
  select p_ov, p_variant, p_couple, v_total, v_first,
         coalesce(v_m50, fm.c), coalesce(v_m100, fm.c), coalesce(v_m200, fm.c), fm.c,
         (select count(*) from sim_taste a join sim_taste b using (ov, couple, name_id)
          where a.ov = p_ov and a.couple = p_couple and a.partner = 1 and b.partner = 2 and a.likes and b.likes),
         v_dry[1], v_dry[2], v_dups,
         (select count(distinct name_id) from sim_offered where partner = 1),
         (select count(distinct name_id) from sim_offered where partner = 2)
  from (select count(*)::int as c from public.matches where nursery_id = v_nursery) fm;
end $$;

do $$
declare
  v_ov numeric; v_couple int; v_pair text; v_label text; v_fn text;
begin
  foreach v_ov in array (select array_agg(x::numeric) from unnest(string_to_array(current_setting('sim.overlaps'), ',')) x) loop
    for v_couple in 1..current_setting('sim.couples')::int loop
      perform pg_temp.make_taste(v_ov, v_couple);
      foreach v_pair in array string_to_array(current_setting('sim.variants'), ',') loop
        v_label := split_part(v_pair, '=', 1);
        v_fn := case when v_pair = 'random=random' then 'pg_temp.sim_random_deck' else split_part(v_pair, '=', 2) end;
        if v_fn !~ '^(pg_temp|public)\.[a-z_][a-z_0-9]*$' then raise exception 'Bad variant function: %', v_fn; end if;
        perform pg_temp.run_couple(v_ov, v_label, v_fn, v_couple);
      end loop;
    end loop;
  end loop;
end $$;

\echo
\echo '== Settings =='
select :'couples' as couples_per_cell, :'overlaps' as taste_overlap, :'like_rate' as like_rate, :'noise' as noise,
       :'genders' as nursery_genders, :'batch' as batch_size, :'seed' as seed;

\echo
\echo '== Results (swipes are both partners combined; "first match" counts only couples that matched) =='
select ov as overlap, variant,
       count(*) as couples,
       round(100.0 * count(first_match) / count(*)) as "% matched",
       percentile_disc(0.5) within group (order by first_match) as "median swipes to 1st match",
       round(100.0 * sum(matches) / nullif(sum(swipes), 0), 2) as "matches/100 swipes (whole run)",
       round(avg(m50), 2) as "matches @50", round(avg(m100), 2) as "matches @100", round(avg(m200), 2) as "matches @200",
       round(avg(ceiling), 1) as "reachable matches",
       round(avg((dry_a + dry_b) / 2.0)) as "swipes/partner to dry"
from sim_res group by ov, variant order by ov, variant;

\echo
\echo '== Deck target: at least 1,000 names per partner (one gender, all origins) =='
select g.gender, count(*) as names_in_db,
       case when count(*) >= 1000 then 'PASS' else 'FAIL' end as "target >= 1000"
from public.names n cross join lateral (select n.gender) g group by g.gender order by g.gender;
select count(*) as names_in_db_total from public.names;
select variant, min(least(offered_a, offered_b)) as "fewest distinct names offered to a partner"
from sim_res group by variant order by variant;

\echo
\echo '== Repeat check: no name offered twice to the same partner =='
select count(*) as runs, sum(dup_offers) as repeated_offers,
       case when coalesce(sum(dup_offers), 0) = 0 then 'PASS' else 'FAIL' end as result from sim_res;

rollback;
