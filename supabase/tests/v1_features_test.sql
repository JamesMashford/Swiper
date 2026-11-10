-- Behaviour tests for migration 20261110000000_v1_features.sql.
-- Run against a scratch database that already has migrations 1 to 4 applied and NO name
-- data (it aborts otherwise), e.g.:  psql -v ON_ERROR_STOP=1 -f supabase/tests/v1_features_test.sql
-- Everything happens in one transaction that is rolled back at the end. Any failed
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

-- Users: A and B share nursery N1; C and D share N2; E has no nursery.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@t'), ('00000000-0000-0000-0000-0000000000b1', 'b@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@t'), ('00000000-0000-0000-0000-0000000000d1', 'd@t'),
  ('00000000-0000-0000-0000-0000000000e1', 'e@t');
insert into public.nurseries (id, invite_code, created_by) values
  ('00000000-0000-0000-0000-00000000aaa1', 'BABY-TST1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000aaa2', 'BABY-TST2', '00000000-0000-0000-0000-0000000000c1');
insert into public.nursery_members (nursery_id, user_id) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000d1');

-- 300 synthetic names. gender = i%3, origin = (i/3)%3, tag = i%5, syllables = 1 + i%3.
-- Names 1..10 are starters.
insert into public.names (name, gender, origins, style_tags, syllables, popularity, is_starter)
select 'ZT_' || i,
       (array['boy', 'girl', 'neutral'])[1 + i % 3],
       array[(array['English', 'Irish', 'French'])[1 + (i / 3) % 3]],
       array[(array['classic', 'nature', 'modern', 'royal', 'soft'])[1 + i % 5]],
       (1 + i % 3)::smallint, 50, i <= 10
from generate_series(1, 300) i;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$ begin
  perform pg_temp.chk(not has_function_privilege('anon', 'public.suggest_names(int)', 'execute'), 'anon cannot suggest_names');
  perform pg_temp.chk(not has_function_privilege('anon', 'public.save_ranking(bigint[])', 'execute'), 'anon cannot save_ranking');
  perform pg_temp.chk(not has_function_privilege('anon', 'public.shortlist_scores()', 'execute'), 'anon cannot shortlist_scores');
  perform pg_temp.chk(has_function_privilege('authenticated', 'public.suggest_names(int)', 'execute'), 'authenticated can suggest_names');
  perform pg_temp.chk(has_function_privilege('authenticated', 'public.save_ranking(bigint[])', 'execute'), 'authenticated can save_ranking');
  perform pg_temp.chk(has_function_privilege('authenticated', 'public.shortlist_scores()', 'execute'), 'authenticated can shortlist_scores');
  perform pg_temp.chk(not has_function_privilege('authenticated', 'public.member_elo(uuid,uuid)', 'execute'), 'member_elo is internal');
  perform pg_temp.chk(not has_function_privilege('anon', 'public.member_elo(uuid,uuid)', 'execute'), 'anon cannot member_elo');
end $$;

do $$ declare ok boolean := false; begin
  set local role anon;
  begin perform * from public.suggest_names(5); exception when insufficient_privilege then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'anon call to suggest_names is refused');
end $$;

-- ---------------------------------------------------------------------------
-- Starter deck (A has 0 likes)
-- ---------------------------------------------------------------------------
do $$ declare v_ids bigint[]; v_n int; begin
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select count(*) into v_n from public.names where is_starter;
  perform pg_temp.chk(v_n = 10, '10 starters exist');

  set local role authenticated;
  perform pg_temp.chk((select count(*) from public.suggest_names(10)) = 10, 'starter batch has 10 rows');
  perform pg_temp.chk((select count(*) = 10 from public.suggest_names(10) s join public.names nm on nm.id = s.id where nm.is_starter),
                      'new user gets only starters while starters remain');
  perform pg_temp.chk((select count(*) from public.suggest_names(4)) = 4, 'p_n is respected');
  perform pg_temp.chk((select count(*) from public.suggest_names(0)) = 0, 'p_n = 0 returns nothing');
  reset role;

  -- A dislikes 3 starters and likes 2: those never come back, others still do.
  insert into public.swipes (user_id, name_id, liked)
  select '00000000-0000-0000-0000-0000000000a1', n.id, n.id % 2 = 0
  from (select id from public.names where is_starter order by id limit 5) n;
  select array_agg(name_id) into v_ids from public.swipes where user_id = '00000000-0000-0000-0000-0000000000a1';
  set local role authenticated;
  perform pg_temp.chk((select count(*) from public.suggest_names(10) s where s.id = any (v_ids)) = 0, 'swiped starters not returned');
  perform pg_temp.chk((select count(*) = 5 from public.suggest_names(5) s join public.names nm on nm.id = s.id where nm.is_starter),
                      'remaining 5 starters still served first');
  reset role;

  -- Starters exhausted: tops up with non-starters.
  insert into public.swipes (user_id, name_id, liked)
  select '00000000-0000-0000-0000-0000000000a1', id, false from public.names where is_starter and id <> all (v_ids);
  set local role authenticated;
  perform pg_temp.chk((select count(*) = 10 from public.suggest_names(10)), 'tops up when starters run out');
  perform pg_temp.chk((select count(*) = 0 from public.suggest_names(10) s join public.names nm on nm.id = s.id where nm.is_starter),
                      'no starters left to serve');
  reset role;
end $$;

-- Filters: nursery genders and origins.
do $$ begin
  update public.nurseries set genders = array['girl'], origins = array['English', 'French']
   where id = '00000000-0000-0000-0000-00000000aaa1';
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true);
  set local role authenticated;
  perform pg_temp.chk((select count(*) = 30 from public.suggest_names(30)), 'filtered deck still fills');
  perform pg_temp.chk((select bool_and(s.gender = 'girl' and s.origins && array['English', 'French']) from public.suggest_names(40) s),
                      'gender and origin filters applied (starter mode)');
  reset role;
  update public.nurseries set genders = array['boy', 'girl', 'neutral'], origins = '{}'
   where id = '00000000-0000-0000-0000-00000000aaa1';
  set local role authenticated;
  perform pg_temp.chk((select count(distinct s.gender) = 3 from public.suggest_names(60) s), 'empty origins and all genders = no filtering');
  reset role;
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000e1', true);
  set local role authenticated;
  perform pg_temp.chk((select count(*) = 0 from public.suggest_names(10)), 'caller without nursery gets an empty set');
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Taste ranking (A reaches 16 likes: all girl + English; B likes 5 of them => 5 matches)
-- ---------------------------------------------------------------------------
create temp table t_ids as
  select row_number() over (order by id) as k, id from public.names where gender = 'girl' and origins = array['English'] and not is_starter;

do $$ declare v_a uuid := '00000000-0000-0000-0000-0000000000a1'; v_b uuid := '00000000-0000-0000-0000-0000000000b1'; v_x bigint; v_seen bigint[] := '{}'; v_nongirl int := 0; r record; v_likes int; begin
  insert into public.swipes (user_id, name_id, liked) select v_a, id, true from t_ids where k <= 16;
  select count(*) into v_likes from public.swipes where user_id = v_a and liked;
  perform pg_temp.chk(v_likes >= 15, 'A has at least 15 likes');
  insert into public.swipes (user_id, name_id, liked) select v_b, id, true from t_ids where k <= 5;
  perform pg_temp.chk((select count(*) = 5 from public.matches where nursery_id = '00000000-0000-0000-0000-00000000aaa1'), '5 matches formed');

  -- B dislikes an unswiped girl-English name; A must still be able to get it.
  select id into v_x from t_ids where k = 20;
  insert into public.swipes (user_id, name_id, liked) values (v_b, v_x, false);

  perform set_config('request.uid', v_a::text, true);
  set local role authenticated;
  for i in 1..30 loop
    for r in select s.id, s.gender, s.origins from public.suggest_names(10) s loop
      perform pg_temp.chk(not exists (select 1 from public.swipes w where w.user_id = v_a and w.name_id = r.id), 'taste batch never has swiped names');
      if not (r.gender = 'girl' and r.origins = array['English']) then v_nongirl := v_nongirl + 1; end if;
    end loop;
    perform pg_temp.chk((select count(*) = 10 and count(distinct s.id) = 10 from public.suggest_names(10) s), 'taste batch: 10 distinct rows');
    perform pg_temp.chk((select count(*) >= 8 from public.suggest_names(10) s where s.gender = 'girl' and s.origins = array['English']),
                        'taste batch leans to the liked gender+origin (>= 8 of 10)');
  end loop;
  perform pg_temp.chk(v_nongirl > 0, 'random picks appear across 30 batches');
  perform pg_temp.chk((select count(*) from public.suggest_names(4)) = 4, 'small batch fills (no random slot when p_n < 5)');
  -- Whole remaining deck, to prove completeness and that a partner-disliked name is not hidden.
  perform pg_temp.chk((select count(*) from public.suggest_names(1000)) = (select count(*) from public.names) - (select count(*) from public.swipes where user_id = v_a),
                      'p_n large returns exactly all unswiped names');
  perform pg_temp.chk(exists (select 1 from public.suggest_names(1000) s where s.id = v_x), 'name the partner disliked can still be suggested');
  reset role;

  -- Exhausted deck.
  insert into public.swipes (user_id, name_id, liked)
  select v_a, id, false from public.names n where not exists (select 1 from public.swipes w where w.user_id = v_a and w.name_id = n.id);
  set local role authenticated;
  perform pg_temp.chk((select count(*) = 0 from public.suggest_names(10)), 'empty set when the deck is exhausted');
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- save_ranking
-- ---------------------------------------------------------------------------
create temp table t_m as select row_number() over (order by name_id) as k, name_id as id
  from public.matches where nursery_id = '00000000-0000-0000-0000-00000000aaa1';

do $$ declare v_a uuid := '00000000-0000-0000-0000-0000000000a1'; v_n1 uuid := '00000000-0000-0000-0000-00000000aaa1'; v_bad bigint; ok boolean; begin
  select id into v_bad from public.names where gender = 'boy' limit 1;
  perform set_config('request.uid', v_a::text, true);
  set local role authenticated;
  perform public.save_ranking((select array_agg(id order by k) from t_m));  -- first save: all five
  perform public.save_ranking(array[(select id from t_m where k = 3), (select id from t_m where k = 1), (select id from t_m where k = 2)]);
  reset role;
  perform pg_temp.chk((select count(*) = 3 from public.rankings where user_id = v_a), 'ranking replaced, not appended');
  perform pg_temp.chk((select position = 0 from public.rankings where user_id = v_a and name_id = (select id from t_m where k = 3)), 'first id gets position 0');
  perform pg_temp.chk((select position = 2 from public.rankings where user_id = v_a and name_id = (select id from t_m where k = 2)), 'order preserved');

  -- Non-match id rejected, ranking unchanged.
  ok := false; set local role authenticated;
  begin perform public.save_ranking(array[(select id from t_m where k = 1), v_bad]); exception when others then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'non-match id rejected');
  perform pg_temp.chk((select count(*) = 3 from public.rankings where user_id = v_a), 'rejected save leaves ranking untouched');
  -- Duplicates rejected.
  ok := false; set local role authenticated;
  begin perform public.save_ranking(array[(select id from t_m where k = 1), (select id from t_m where k = 1)]); exception when others then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'duplicate ids rejected');
  -- Caller without a nursery.
  ok := false; perform set_config('request.uid', '00000000-0000-0000-0000-0000000000e1', true); set local role authenticated;
  begin perform public.save_ranking('{}'); exception when others then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'caller without nursery rejected');
  -- Another nursery's member cannot rank this nursery's matches.
  ok := false; perform set_config('request.uid', '00000000-0000-0000-0000-0000000000c1', true); set local role authenticated;
  begin perform public.save_ranking(array[(select id from t_m where k = 1)]); exception when others then ok := true; end;
  reset role;
  perform pg_temp.chk(ok, 'other nursery cannot rank foreign matches');
  -- Empty array clears; then restore.
  perform set_config('request.uid', v_a::text, true); set local role authenticated;
  perform public.save_ranking('{}'); reset role;
  perform pg_temp.chk((select count(*) = 0 from public.rankings where user_id = v_a), 'empty array clears ranking');
  set local role authenticated;
  perform public.save_ranking(array[(select id from t_m where k = 3), (select id from t_m where k = 1), (select id from t_m where k = 2)]);
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- shortlist_scores
-- ---------------------------------------------------------------------------
do $$ declare v_a uuid := '00000000-0000-0000-0000-0000000000a1'; v_b uuid := '00000000-0000-0000-0000-0000000000b1'; r record; v_z bigint; begin
  -- B ranks m3, m2, m1, m4, m5.
  perform set_config('request.uid', v_b::text, true); set local role authenticated;
  perform public.save_ranking((select array_agg(id order by case k when 3 then 0 when 2 then 1 when 1 then 2 else k end) from t_m));
  reset role;

  perform set_config('request.uid', v_a::text, true); set local role authenticated;
  perform pg_temp.chk((select count(*) = 5 from public.shortlist_scores()), 'A sees exactly the 5 nursery matches');
  perform pg_temp.chk((select my_position is null from public.shortlist_scores() where name_id = (select id from t_m where k = 4)), 'my_position null for unranked');
  perform pg_temp.chk((select my_position = 0 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)), 'my_position is the caller''s own');
  perform pg_temp.chk((select combined_rank = 1 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)), 'both partners rank m3 first => combined rank 1');
  perform pg_temp.chk((select combined_rank = 2 from public.shortlist_scores() where name_id = (select id from t_m where k = 1)), 'm1 is second');
  perform pg_temp.chk((select combined_rank = 5 from public.shortlist_scores() where name_id = (select id from t_m where k = 5)), 'm5 is last');
  perform pg_temp.chk((select array_agg(combined_rank order by combined_rank) = array[1,2,3,4,5] from public.shortlist_scores()), 'combined ranks are 1..5, distinct');
  perform pg_temp.chk((select bool_and(my_elo = 1000) from public.shortlist_scores()), 'Elo starts at 1000');
  perform pg_temp.chk((select bool_and(name is not null and gender is not null) from public.shortlist_scores()), 'name details returned');
  reset role;

  -- Partner's numbers do not leak: B's view has B's own positions.
  perform set_config('request.uid', v_b::text, true); set local role authenticated;
  perform pg_temp.chk((select my_position = 4 from public.shortlist_scores() where name_id = (select id from t_m where k = 5)), 'B sees B''s own position');
  perform pg_temp.chk((select combined_rank = 1 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)), 'combined rank identical for both partners');
  reset role;

  -- Elo: A: m1 beats m2 once.
  insert into public.duels (nursery_id, user_id, winner_name_id, loser_name_id)
  values ('00000000-0000-0000-0000-00000000aaa1', v_a, (select id from t_m where k = 1), (select id from t_m where k = 2));
  perform set_config('request.uid', v_a::text, true); set local role authenticated;
  perform pg_temp.chk((select my_elo = 1016 from public.shortlist_scores() where name_id = (select id from t_m where k = 1)), 'winner gains 16 after first duel');
  perform pg_temp.chk((select my_elo = 984 from public.shortlist_scores() where name_id = (select id from t_m where k = 2)), 'loser loses 16 after first duel');
  perform pg_temp.chk((select my_elo = 1000 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)), 'uninvolved name stays 1000');
  reset role;
  insert into public.duels (nursery_id, user_id, winner_name_id, loser_name_id)
  values ('00000000-0000-0000-0000-00000000aaa1', v_a, (select id from t_m where k = 1), (select id from t_m where k = 2)),
         ('00000000-0000-0000-0000-00000000aaa1', v_a, (select id from t_m where k = 2), (select id from t_m where k = 3));
  set local role authenticated;
  perform pg_temp.chk((select my_elo > 1016 from public.shortlist_scores() where name_id = (select id from t_m where k = 1)), 'second win raises Elo further, with diminishing gain');
  perform pg_temp.chk((select my_elo < 1000 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)), 'loser to m2 drops below 1000');
  perform pg_temp.chk((select sum(my_elo) between 5000 - 3 and 5000 + 3 from public.shortlist_scores()), 'Elo is zero-sum (within rounding)');
  perform pg_temp.chk((select combined_rank = 1 from public.shortlist_scores() where name_id = (select id from t_m where k = 3)) is not null, 'ranks still computed after duels');
  reset role;
  -- B has no duels: still 1000 everywhere.
  perform set_config('request.uid', v_b::text, true); set local role authenticated;
  perform pg_temp.chk((select bool_and(my_elo = 1000) from public.shortlist_scores()), 'partner''s duels do not change my Elo');
  reset role;

  -- A third user in another nursery sees none of it.
  select id into v_z from public.names where gender = 'boy' and not is_starter order by id limit 1;
  insert into public.swipes (user_id, name_id, liked) values
    ('00000000-0000-0000-0000-0000000000c1', v_z, true), ('00000000-0000-0000-0000-0000000000d1', v_z, true);
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000c1', true); set local role authenticated;
  perform pg_temp.chk((select count(*) = 1 and bool_and(name_id = v_z) from public.shortlist_scores()), 'other nursery sees only its own match');
  reset role;
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000e1', true); set local role authenticated;
  perform pg_temp.chk((select count(*) = 0 from public.shortlist_scores()), 'no nursery => empty shortlist');
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Direct table access: partner's data stays private
-- ---------------------------------------------------------------------------
do $$ begin
  perform set_config('request.uid', '00000000-0000-0000-0000-0000000000b1', true); set local role authenticated;
  perform pg_temp.chk((select count(*) = 0 from public.rankings where user_id = '00000000-0000-0000-0000-0000000000a1'), 'partner rankings unreadable');
  perform pg_temp.chk((select count(*) = 0 from public.duels where user_id = '00000000-0000-0000-0000-0000000000a1'), 'partner duels unreadable');
  perform pg_temp.chk((select count(*) = 0 from public.swipes where user_id = '00000000-0000-0000-0000-0000000000a1'), 'partner swipes unreadable');
  perform pg_temp.chk((select count(*) = 5 from public.rankings), 'own rankings readable');
  reset role;
end $$;

do $$ begin
  raise notice 'ALL % ASSERTIONS PASSED', current_setting('t.n');
end $$;

rollback;
