-- Minimal stand-in for the Supabase pieces the migrations and tests rely on, so they can
-- run on a plain local Postgres. NOT for the live project. Apply before the migrations:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/local_supabase_shim.sql
-- Notes: `extensions.vector` is not provided (pgvector is usually absent locally). The
-- migration runner in supabase/tests/run_local.sh swaps `vector(384)` for `real[]`.
-- Roles are cluster-wide, so tolerate a second run on the same server.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions to anon, authenticated;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);
-- The tests pick the caller with set_config('request.uid', ..., true).
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.uid', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
