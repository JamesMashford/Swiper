-- Tests for migration 20261127000000_market_and_portuguese_origin.sql (issue #6).
-- Run on a scratch database with ALL migrations applied and NO name data, e.g. via
-- supabase/tests/run_local.sh. One transaction, rolled back at the end; any failed
-- assertion raises and aborts the run.
begin;

create function pg_temp.chk(p_ok boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
  perform set_config('t.n', (coalesce(nullif(current_setting('t.n', true), ''), '0')::int + 1)::text, true);
end $$;

do $$ begin
  if exists (select 1 from public.names) then
    raise exception 'Refusing to run: public.names is not empty (use a scratch database)';
  end if;
end $$;

-- A and B share nursery N1 (market filter set per test); C and D share N2 (never filtered).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@t'), ('00000000-0000-0000-0000-0000000000b1', 'b@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@t'), ('00000000-0000-0000-0000-0000000000d1', 'd@t');
insert into public.nurseries (id, invite_code, created_by) values
  ('00000000-0000-0000-0000-00000000aaa1', 'BABY-MKT1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000aaa2', 'BABY-MKT2', '00000000-0000-0000-0000-0000000000c1');
insert into public.nursery_members (nursery_id, user_id) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000d1');

-- 120 names ZM_1..ZM_120. Market group = i % 4:
--   0: Italy only   1: Brazil only   2: UK and Italy   3: no market rows at all
-- Names 1..12 are starters, so starters exist in every group. Genders cycle boy/girl/neutral.
insert into public.names (name, gender, origins, style_tags, syllables, popularity, is_starter)
select 'ZM_' || i,
       (array['boy', 'girl', 'neutral'])[1 + i % 3],
       array[(array['English', 'Portuguese', 'Italian'])[1 + i % 3]],
       array[(array['classic', 'nature', 'modern'])[1 + i % 3]],
       (1 + i % 3)::smallint, 50, i <= 12
from generate_series(1, 120) i;

insert into public.name_market_popularity (name_id, market, popularity)
select nm.id, m.market, 10 + (nm.id % 80)::int
from public.names nm
cross join lateral (
  select unnest(case substr(nm.name, 4)::int % 4
                  when 0 then array['Italy']
                  when 1 then array['Brazil']
                  when 2 then array['UK', 'Italy']
                  else array[]::text[] end) as market
) m;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
do $$ declare ok boolean; v_def text; begin
  perform pg_temp.chk((select array_agg(code order by position) from public.markets)
                      = array['UK', 'US', 'Scandinavia', 'Italy', 'Brazil'], 'markets are UK, US, Scandinavia, Italy, Brazil in order');
  -- The CHECK list on nurseries.markets must equal public.markets.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'nurseries_markets_valid' and conrelid = 'public.nurseries'::regclass;
  perform pg_temp.chk((select bool_and(v_def like '%''' || code || '''%') from public.markets),
                      'nurseries_markets_valid lists every market');
  perform pg_temp.chk((select count(*) from regexp_matches(v_def, '''[A-Za-z]+''', 'g')) = (select count(*) from public.markets),
                      'nurseries_markets_valid lists no extra market');
  perform pg_temp.chk((select markets from public.nurseries where invite_code = 'BABY-MKT1') = '{}',
                      'a nursery has no market filter by default');
  perform pg_temp.chk((select column_default from information_schema.columns
                       where table_name = 'nurseries' and column_name = 'markets') like '%{}%', 'default is empty = all markets');
  perform pg_temp.chk((select popularity from public.names where name = 'ZM_5') = 50,
                      'names.popularity still works');

  -- market popularity rows
  perform pg_temp.chk((select count(*) from public.name_market_popularity) = 30 + 30 + 60, 'market rows loaded');
  ok := false; begin insert into public.name_market_popularity values (1, 'Atlantis', 5);
  exception when foreign_key_violation then ok := true; end;
  perform pg_temp.chk(ok, 'unknown market is rejected in name_market_popularity');
  ok := false; begin insert into public.name_market_popularity select id, 'US', 0 from public.names limit 1;
  exception when check_violation then ok := true; end;
  perform pg_temp.chk(ok, 'zero popularity is rejected');
  ok := false; begin insert into public.name_market_popularity select id, 'Italy', 5 from public.names where name = 'ZM_4';
  exception when unique_violation then ok := true; end;
  perform pg_temp.chk(ok, 'one popularity per name and market');
end $$;

-- ---------------------------------------------------------------------------
-- Nursery checks: Portuguese origin, origin limit, market limit and values
-- ---------------------------------------------------------------------------
do $$ declare ok boolean; v_all text[] := array['English','Irish','Scottish','Welsh','French','Spanish','Italian','German','Scandinavian','Greek','Latin','Hebrew','Arabic','Indian','Japanese','African','Slavic','Celtic','Portuguese','Other']; begin
  perform pg_temp.chk(cardinality(v_all) = 20, 'the origin list has 20 entries');
  update public.nurseries set origins = array['Portuguese'] where invite_code = 'BABY-MKT2';
  perform pg_temp.chk((select origins from public.nurseries where invite_code = 'BABY-MKT2') = array['Portuguese'], 'Portuguese can be stored as an origin');
  update public.nurseries set origins = v_all where invite_code = 'BABY-MKT2';
  perform pg_temp.chk(cardinality((select origins from public.nurseries where invite_code = 'BABY-MKT2')) = 20, 'all 20 origins can be selected');
  update public.nurseries set origins = '{}' where invite_code = 'BABY-MKT2';
  ok := false; begin update public.nurseries set origins = v_all || 'Extra'::text where invite_code = 'BABY-MKT2';
  exception when check_violation then ok := true; end;
  perform pg_temp.chk(ok, '21 origins are still rejected');

  update public.nurseries set markets = array['UK', 'US', 'Scandinavia', 'Italy', 'Brazil'] where invite_code = 'BABY-MKT2';
  perform pg_temp.chk(cardinality((select markets from public.nurseries where invite_code = 'BABY-MKT2')) = 5, 'all five markets can be selected');
  update public.nurseries set markets = '{}' where invite_code = 'BABY-MKT2';
  ok := false; begin update public.nurseries set markets = array['UK','US','Scandinavia','Italy','Brazil','UK'] where invite_code = 'BABY-MKT2';
  exception when check_violation then ok := true; end;
  perform pg_temp.chk(ok, 'more than 5 markets is rejected (length check)');
  ok := false; begin update public.nurseries set markets = array['Atlantis'] where invite_code = 'BABY-MKT2';
  exception when check_violation then ok := true; end;
  perform pg_temp.chk(ok, 'an unknown market is rejected');
  ok := false; begin update public.nurseries set markets = array['uk'] where invite_code = 'BABY-MKT2';
  exception when check_violation then ok := true; end;
  perform pg_temp.chk(ok, 'market codes are case sensitive');
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$ declare ok boolean; begin
  perform pg_temp.chk(not has_function_privilege('authenticated', 'public.name_in_markets(bigint,text[])', 'execute'), 'name_in_markets is internal');
  perform pg_temp.chk(not has_function_privilege('anon', 'public.name_in_markets(bigint,text[])', 'execute'), 'anon cannot name_in_markets');
  perform pg_temp.chk(not has_function_privilege('anon', 'public.suggest_names(int)', 'execute'), 'anon still cannot suggest_names');
  perform pg_temp.chk(has_function_privilege('authenticated', 'public.suggest_names(int)', 'execute'), 'authenticated can suggest_names');

  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  perform pg_temp.chk((select count(*) from public.markets) = 5, 'signed-in users read markets');
  perform pg_temp.chk((select count(*) from public.name_market_popularity) = 120, 'signed-in users read market popularity');
  ok := false; begin insert into public.name_market_popularity select id, 'US', 5 from public.names limit 1;
  exception when insufficient_privilege then ok := true; end;
  perform pg_temp.chk(ok, 'signed-in users cannot write market popularity');
  ok := false; begin insert into public.markets values ('Mars', 9);
  exception when insufficient_privilege then ok := true; end;
  perform pg_temp.chk(ok, 'signed-in users cannot add markets');
  -- A member can change the market filter, and still cannot touch the invite code.
  update public.nurseries set markets = array['Italy'] where id = '00000000-0000-0000-0000-00000000aaa1';
  perform pg_temp.chk((select markets from public.nurseries where id = '00000000-0000-0000-0000-00000000aaa1') = array['Italy'], 'a member can set the market filter');
  ok := false; begin update public.nurseries set invite_code = 'HACK' where id = '00000000-0000-0000-0000-00000000aaa1';
  exception when insufficient_privilege then ok := true; end;
  perform pg_temp.chk(ok, 'invite_code is still not updatable');
  reset role;

  -- anon gets nothing
  set local role anon;
  ok := false; begin perform 1 from public.name_market_popularity;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'anon cannot read market popularity');
end $$;

-- ---------------------------------------------------------------------------
-- Market filter in suggest_names (N1 is now filtered to Italy by the update above).
-- Groups: 0 Italy only, 1 Brazil only, 2 UK and Italy, 3 no market rows.
-- ---------------------------------------------------------------------------
create function pg_temp.grp(p_name text) returns int language sql immutable as $$ select substr(p_name, 4)::int % 4 $$;

-- Starter deck path (A has no likes). Starters exist in every group, so a leak would show.
do $$ declare v_bad int; v_n int; begin
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select count(*), count(*) filter (where pg_temp.grp(s.name) not in (0, 2)) into v_n, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_n = 60, 'Italy nursery, starter path: exactly the 60 Italy names are available');
  perform pg_temp.chk(v_bad = 0, 'Italy nursery, starter path: no name outside Italy');

  -- 200 small batches, in case the leak is random
  v_bad := 0;
  for i in 1..200 loop
    set local role authenticated;
    v_bad := v_bad + (select count(*) from public.suggest_names(5) s where pg_temp.grp(s.name) not in (0, 2));
    reset role;
  end loop;
  perform pg_temp.chk(v_bad = 0, 'Italy nursery, starter path: 0 outside names in 200 batches of 5');

  -- starters outside the market are not served either
  set local role authenticated;
  perform pg_temp.chk((select count(*) from public.suggest_names(500) s join public.names nm on nm.id = s.id
                       where nm.is_starter and pg_temp.grp(s.name) in (1, 3)) = 0, 'starters outside the market are not served');
  reset role;
end $$;

-- Taste path: A needs 15 likes. Like 15 Italy names.
do $$ declare v_bad int; v_n int; begin
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  insert into public.swipes (user_id, name_id, liked)
  select '00000000-0000-0000-0000-0000000000a1', nm.id, true
  from public.names nm where pg_temp.grp(nm.name) = 0 order by nm.id limit 15;
  select count(*), count(*) filter (where pg_temp.grp(s.name) not in (0, 2)) into v_n, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_n = 45, 'Italy nursery, taste path: the 45 unswiped Italy names are available');
  perform pg_temp.chk(v_bad = 0, 'Italy nursery, taste path: no name outside Italy');

  v_bad := 0;
  for i in 1..200 loop
    set local role authenticated;
    v_bad := v_bad + (select count(*) from public.suggest_names(10) s where pg_temp.grp(s.name) not in (0, 2));
    reset role;
  end loop;
  perform pg_temp.chk(v_bad = 0, 'Italy nursery, taste path: 0 outside names in 200 batches of 10 (incl. random picks)');
end $$;

-- Brazil only: group 1 (30 names), including the two paths.
do $$ declare v_n int; v_bad int; begin
  update public.nurseries set markets = array['Brazil'] where id = '00000000-0000-0000-0000-00000000aaa1';
  -- B (no likes): starter path
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*), count(*) filter (where pg_temp.grp(s.name) <> 1) into v_n, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_n = 30 and v_bad = 0, 'Brazil nursery, starter path: exactly the 30 Brazil names');
  -- A (15 likes, all Italy): taste path. The liked Italy names are already swiped; none are Brazil.
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select count(*), count(*) filter (where pg_temp.grp(s.name) <> 1) into v_n, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_n = 30 and v_bad = 0, 'Brazil nursery, taste path: exactly the 30 Brazil names, taste history in another market notwithstanding');
end $$;

-- Two markets are a union; a name in both is returned once.
do $$ declare v_n int; v_dups int; v_bad int; begin
  update public.nurseries set markets = array['UK', 'Brazil'] where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*), count(*) - count(distinct s.id), count(*) filter (where pg_temp.grp(s.name) not in (1, 2))
    into v_n, v_dups, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_n = 60, 'UK + Brazil: Brazil-only (30) plus UK-and-Italy (30) names');
  perform pg_temp.chk(v_dups = 0 and v_bad = 0, 'UK + Brazil: no duplicates and nothing outside the two markets');
end $$;

-- A market with no names yields an empty deck, never a fallback to other markets.
do $$ declare v_n int; begin
  update public.nurseries set markets = array['Scandinavia'] where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*) into v_n from public.suggest_names(500);
  reset role;
  perform pg_temp.chk(v_n = 0, 'a market with no names returns an empty deck (no leak, no fallback)');
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select count(*) into v_n from public.suggest_names(500);
  reset role;
  perform pg_temp.chk(v_n = 0, 'same on the taste path');
end $$;

-- Markets combine with the gender and origin filters.
do $$ declare v_n int; v_bad int; begin
  update public.nurseries set markets = array['Italy'], genders = array['girl'], origins = array['Portuguese']
  where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*), count(*) filter (where pg_temp.grp(s.name) not in (0, 2) or s.gender <> 'girl' or not (s.origins && array['Portuguese']))
    into v_n, v_bad from public.suggest_names(500) s;
  reset role;
  perform pg_temp.chk(v_bad = 0, 'market + gender + origin filters all hold together');
  perform pg_temp.chk(v_n = (select count(*) from public.names nm
                             where pg_temp.grp(nm.name) in (0, 2) and nm.gender = 'girl' and nm.origins && array['Portuguese']),
                      'market + gender + origin returns exactly the intersection');
  perform pg_temp.chk(v_n > 0, 'the intersection used in the test is not empty');
end $$;

-- No filter (default) still serves everything, including names with no market rows.
do $$ declare v_n int; begin
  update public.nurseries set markets = '{}', genders = array['boy','girl','neutral'], origins = '{}'
  where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  select count(*) into v_n from public.suggest_names(500);
  reset role;
  perform pg_temp.chk(v_n = 120, 'no market filter: all 120 names, including the 30 without market data');
end $$;

-- The unfiltered nursery N2 is not affected by N1's filter.
do $$ declare v_n int; begin
  update public.nurseries set markets = array['Italy'] where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000c1', true);
  set local role authenticated;
  select count(*) into v_n from public.suggest_names(500);
  reset role;
  perform pg_temp.chk(v_n = 120, 'another nursery without a filter still sees all names');
end $$;

do $$ begin raise notice 'ALL % ASSERTIONS PASSED', current_setting('t.n'); end $$;
rollback;
