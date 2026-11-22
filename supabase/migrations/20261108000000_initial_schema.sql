-- Swiper v1 schema: profiles, nurseries, names, swipes, matches, rankings, duels.
-- Privacy model: partners can never read each other's swipes. They only see `matches`,
-- which are created by SECURITY DEFINER triggers.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Nurseries (shared space for two partners)
-- ---------------------------------------------------------------------------
create table public.nurseries (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  surname text not null default '',
  genders text[] not null default array['boy', 'girl', 'neutral'],
  origins text[] not null default '{}',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint nurseries_genders_valid check (genders <@ array['boy', 'girl', 'neutral'])
);

create table public.nursery_members (
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (nursery_id, user_id),
  -- v1: a person belongs to at most one nursery
  unique (user_id)
);

-- Enforce at most two members per nursery.
create function public.enforce_nursery_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.nurseries where id = new.nursery_id for update;
  if (select count(*) from public.nursery_members where nursery_id = new.nursery_id) >= 2 then
    raise exception 'This nursery already has two members' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger nursery_members_max_two
  before insert on public.nursery_members
  for each row execute function public.enforce_nursery_size();

-- Membership check used by RLS policies. SECURITY DEFINER avoids policy recursion.
create function public.is_nursery_member(p_nursery_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.nursery_members
    where nursery_id = p_nursery_id and user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------
create table public.names (
  id bigint generated always as identity primary key,
  name text not null,
  gender text not null check (gender in ('boy', 'girl', 'neutral')),
  origins text[] not null default '{}',
  meaning text,
  style_tags text[] not null default '{}',
  syllables smallint,
  popularity integer not null default 0,
  blurb text,
  embedding extensions.vector(384),
  unique (name, gender)
);

create index names_gender_idx on public.names (gender);
-- ANN index is added once names are loaded (see data pipeline, build phase 2).

-- ---------------------------------------------------------------------------
-- Swipes (per person, not per nursery, so solo swipes carry over on linking)
-- ---------------------------------------------------------------------------
create table public.swipes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_id bigint not null references public.names (id) on delete cascade,
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, name_id)
);

create index swipes_name_liked_idx on public.swipes (name_id) where liked;

-- ---------------------------------------------------------------------------
-- Matches (both partners liked the name)
-- ---------------------------------------------------------------------------
create table public.matches (
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  name_id bigint not null references public.names (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (nursery_id, name_id)
);

-- Create matches when a swipe is recorded; remove them if a like flips to a dislike.
create function public.sync_matches_on_swipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nursery uuid;
begin
  select nursery_id into v_nursery
  from public.nursery_members
  where user_id = new.user_id;

  if v_nursery is null then
    return new;
  end if;

  if new.liked then
    insert into public.matches (nursery_id, name_id)
    select v_nursery, new.name_id
    where exists (
      select 1
      from public.nursery_members m
      join public.swipes s on s.user_id = m.user_id
      where m.nursery_id = v_nursery
        and m.user_id <> new.user_id
        and s.name_id = new.name_id
        and s.liked
    )
    on conflict do nothing;
  else
    delete from public.matches where nursery_id = v_nursery and name_id = new.name_id;
  end if;

  return new;
end;
$$;

create trigger swipes_sync_matches
  after insert or update of liked on public.swipes
  for each row execute function public.sync_matches_on_swipe();

-- When a second partner joins, compare their past (solo) swipes.
create function public.backfill_matches_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.matches (nursery_id, name_id)
  select new.nursery_id, s.name_id
  from public.swipes s
  join public.nursery_members m on m.user_id = s.user_id and m.nursery_id = new.nursery_id
  group by s.name_id
  having count(*) = 2 and bool_and(s.liked)
  on conflict do nothing;

  return new;
end;
$$;

create trigger nursery_members_backfill_matches
  after insert on public.nursery_members
  for each row execute function public.backfill_matches_on_join();

-- ---------------------------------------------------------------------------
-- Shortlist: rankings and duels
-- ---------------------------------------------------------------------------
create table public.rankings (
  nursery_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_id bigint not null,
  position integer not null check (position >= 0),
  primary key (nursery_id, user_id, name_id),
  foreign key (nursery_id, name_id) references public.matches (nursery_id, name_id) on delete cascade
);

create table public.duels (
  id bigint generated always as identity primary key,
  nursery_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  winner_name_id bigint not null,
  loser_name_id bigint not null,
  created_at timestamptz not null default now(),
  check (winner_name_id <> loser_name_id),
  foreign key (nursery_id, winner_name_id) references public.matches (nursery_id, name_id) on delete cascade,
  foreign key (nursery_id, loser_name_id) references public.matches (nursery_id, name_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Nursery RPCs
-- ---------------------------------------------------------------------------
create function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- No 0/O/1/I to keep codes easy to read out loud.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := 'BABY-' || (
      select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      from generate_series(1, 4)
    );
    exit when not exists (select 1 from public.nurseries where invite_code = code);
  end loop;
  return code;
end;
$$;

create function public.create_nursery(p_surname text default '')
returns public.nurseries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_nursery public.nurseries;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if exists (select 1 from public.nursery_members where user_id = v_user) then
    raise exception 'You are already in a nursery' using errcode = 'P0001';
  end if;

  insert into public.nurseries (invite_code, surname, created_by)
  values (public.generate_invite_code(), coalesce(p_surname, ''), v_user)
  returning * into v_nursery;

  insert into public.nursery_members (nursery_id, user_id) values (v_nursery.id, v_user);
  return v_nursery;
end;
$$;

create function public.join_nursery(p_code text)
returns public.nurseries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_nursery public.nurseries;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if exists (select 1 from public.nursery_members where user_id = v_user) then
    raise exception 'You are already in a nursery' using errcode = 'P0001';
  end if;

  select * into v_nursery from public.nurseries where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'Invite code not found' using errcode = 'P0002';
  end if;

  -- The size trigger raises if the nursery is already full.
  insert into public.nursery_members (nursery_id, user_id) values (v_nursery.id, v_user);
  return v_nursery;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.nurseries enable row level security;
alter table public.nursery_members enable row level security;
alter table public.names enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.rankings enable row level security;
alter table public.duels enable row level security;

-- profiles: own row, plus your partner's
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.nursery_members mine
      join public.nursery_members theirs on theirs.nursery_id = mine.nursery_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- nurseries: members read and update; creation and joining go through RPCs
create policy nurseries_select on public.nurseries for select to authenticated
  using (public.is_nursery_member(id));
create policy nurseries_update on public.nurseries for update to authenticated
  using (public.is_nursery_member(id)) with check (public.is_nursery_member(id));

-- nursery_members: see who is in your nursery
create policy nursery_members_select on public.nursery_members for select to authenticated
  using (public.is_nursery_member(nursery_id));

-- names: readable by any signed-in user
create policy names_select on public.names for select to authenticated using (true);

-- swipes: strictly your own
create policy swipes_select on public.swipes for select to authenticated
  using (user_id = (select auth.uid()));
create policy swipes_insert on public.swipes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy swipes_update on public.swipes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy swipes_delete on public.swipes for delete to authenticated
  using (user_id = (select auth.uid()));

-- matches: members read; rows are written only by triggers
create policy matches_select on public.matches for select to authenticated
  using (public.is_nursery_member(nursery_id));

-- rankings and duels: your own, inside your nursery
create policy rankings_all on public.rankings for all to authenticated
  using (user_id = (select auth.uid()) and public.is_nursery_member(nursery_id))
  with check (user_id = (select auth.uid()) and public.is_nursery_member(nursery_id));
create policy duels_all on public.duels for all to authenticated
  using (user_id = (select auth.uid()) and public.is_nursery_member(nursery_id))
  with check (user_id = (select auth.uid()) and public.is_nursery_member(nursery_id));

-- ---------------------------------------------------------------------------
-- Grants: RPCs for signed-in users only; helper and trigger functions locked down
-- ---------------------------------------------------------------------------
revoke execute on function public.create_nursery(text) from public, anon;
revoke execute on function public.join_nursery(text) from public, anon;
grant execute on function public.create_nursery(text) to authenticated;
grant execute on function public.join_nursery(text) to authenticated;

revoke execute on function public.generate_invite_code() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_nursery_size() from public, anon, authenticated;
revoke execute on function public.sync_matches_on_swipe() from public, anon, authenticated;
revoke execute on function public.backfill_matches_on_join() from public, anon, authenticated;

-- Broadcast new matches to the nursery over Realtime (RLS applies).
alter publication supabase_realtime add table public.matches;
