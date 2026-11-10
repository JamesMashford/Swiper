-- Members may edit only the nursery's settings, not its invite code, owner or id.
revoke update on public.nurseries from authenticated;
grant update (surname, genders, origins) on public.nurseries to authenticated;
