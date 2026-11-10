#!/usr/bin/env bash
# F2 regression: two overlapping transactions both like the same name; exactly one match
# must exist. Needs a scratch database with migrations applied (it commits and cleans up).
#   PSQL="psql -h /socket/dir -p 5497 -U postgres -d t" bash supabase/tests/concurrency_race.sh
# NOLOCK=1 first reinstalls the pre-fix trigger (no advisory lock) to show the race is real
# (expect 0 matches); afterwards re-run the migration to restore it.
set -euo pipefail
: "${PSQL:?set PSQL to a psql command line}"
Q="$PSQL -q -v ON_ERROR_STOP=1 -At"
if [ "${NOLOCK:-}" = 1 ]; then
  $Q <<'SQL'
create or replace function public.sync_matches_on_swipe() returns trigger language plpgsql security definer set search_path = '' as $f$
declare v_nursery uuid;
begin
  select nursery_id into v_nursery from public.nursery_members where user_id = new.user_id;
  if v_nursery is null then return new; end if;
  if new.liked then
    insert into public.matches (nursery_id, name_id) select v_nursery, new.name_id
    where exists (select 1 from public.nursery_members m join public.swipes s on s.user_id = m.user_id
      where m.nursery_id = v_nursery and m.user_id <> new.user_id and s.name_id = new.name_id and s.liked)
    on conflict do nothing;
  else delete from public.matches where nursery_id = v_nursery and name_id = new.name_id; end if;
  return new;
end $f$;
SQL
fi
$Q <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000ca01','race1@t'),('00000000-0000-0000-0000-00000000ca02','race2@t');
insert into public.nurseries (id, invite_code, created_by) values ('00000000-0000-0000-0000-00000000caff','BABY-RACE','00000000-0000-0000-0000-00000000ca01');
insert into public.nursery_members (nursery_id, user_id) values ('00000000-0000-0000-0000-00000000caff','00000000-0000-0000-0000-00000000ca01'),('00000000-0000-0000-0000-00000000caff','00000000-0000-0000-0000-00000000ca02');
insert into public.names (name, gender) values ('RACE_NAME','neutral');
SQL
NID=$($Q -c "select id from public.names where name='RACE_NAME'")
( $Q -c "begin; insert into public.swipes (user_id,name_id,liked) values ('00000000-0000-0000-0000-00000000ca01',$NID,true); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
$Q -c "begin; insert into public.swipes (user_id,name_id,liked) values ('00000000-0000-0000-0000-00000000ca02',$NID,true); commit;" >/dev/null
wait
N=$($Q -c "select count(*) from public.matches where nursery_id='00000000-0000-0000-0000-00000000caff'")
$Q -c "delete from public.nurseries where id='00000000-0000-0000-0000-00000000caff'; delete from auth.users where id in ('00000000-0000-0000-0000-00000000ca01','00000000-0000-0000-0000-00000000ca02'); delete from public.names where name='RACE_NAME';"
echo "matches after overlapping likes: $N"
[ "$N" = 1 ] && echo "RACE TEST PASSED" || { echo "RACE TEST FAILED"; exit 1; }
