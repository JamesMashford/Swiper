-- Newer Supabase projects do not grant table privileges to API roles automatically.
-- RLS policies still decide which rows each person can touch; these grants only let
-- signed-in users reach the tables at all. Anonymous visitors get nothing.

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.nurseries to authenticated;          -- update columns granted earlier
grant select on public.nursery_members to authenticated;
grant select on public.names to authenticated;
grant select on public.matches to authenticated;            -- written by triggers only

grant select, insert, update, delete on public.swipes to authenticated;
grant select, insert, update, delete on public.rankings to authenticated;
grant select, insert, update, delete on public.duels to authenticated;

-- Deleting a user (e.g. a test account) must not be blocked by nurseries they created.
alter table public.nurseries alter column created_by drop not null;
alter table public.nurseries drop constraint nurseries_created_by_fkey;
alter table public.nurseries
  add constraint nurseries_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
