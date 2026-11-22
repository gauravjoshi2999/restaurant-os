-- A13 Owner support candidate; standalone reviewable SQL, not a production migration.
-- Apply only in isolated QA before promotion via the normal migration process.
begin;
create table public.owner_support_tickets (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict default auth.uid(),
  category text not null check (category in ('Orders','POS','Accounts','Hotel','Technical','Other')),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  message text not null check (char_length(btrim(message)) between 5 and 2000),
  status text not null default 'Open' check (status in ('Open','In Progress','Resolved','Closed')),
  admin_response text check (admin_response is null or char_length(btrim(admin_response)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index owner_support_ticket_owner_scope_idx on public.owner_support_tickets(restaurant_id,owner_id,created_at desc);
create index owner_support_ticket_admin_queue_idx on public.owner_support_tickets(status,created_at desc);
alter table public.owner_support_tickets enable row level security;
revoke all on public.owner_support_tickets from public, anon, authenticated;
grant select on public.owner_support_tickets to authenticated;
grant insert (id,restaurant_id,category,subject,message) on public.owner_support_tickets to authenticated;
grant update (status,admin_response) on public.owner_support_tickets to authenticated;
create policy owner_support_read on public.owner_support_tickets for select to authenticated
using (
  public.is_platform_admin() or
  (owner_id=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']::text[]))
);
create policy owner_support_create on public.owner_support_tickets for insert to authenticated
with check (
  owner_id=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']::text[])
  and status='Open' and admin_response is null
);
create policy owner_support_admin_update on public.owner_support_tickets for update to authenticated
using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create function public.owner_support_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function public.owner_support_touch_updated_at() from public, anon, authenticated;
create trigger owner_support_touch before update on public.owner_support_tickets
for each row execute function public.owner_support_touch_updated_at();
commit;
