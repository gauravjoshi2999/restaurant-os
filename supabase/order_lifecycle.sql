-- RestaurantOS: professional order lifecycle and immutable status history.
-- Run once in Supabase SQL Editor. Safe to re-run.

begin;

alter table public.orders
  add column if not exists status_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_status_allowed_check'
  ) then
    alter table public.orders
      add constraint orders_status_allowed_check
      check (status in (
        'Received','Accepted','Preparing','Ready',
        'Handed Over','Completed','Rejected','Cancelled'
      )) not valid;
  end if;
end;
$$;

alter table public.orders
  validate constraint orders_status_allowed_check;

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx
  on public.order_status_history (order_id, changed_at desc);

alter table public.order_status_history enable row level security;

drop policy if exists "members and platform admins can read order history"
  on public.order_status_history;
create policy "members and platform admins can read order history"
on public.order_status_history
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
);

grant select on public.order_status_history to authenticated;

create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Received' then
      raise exception 'A new order must start with Received status.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  allowed := case old.status
    when 'Received' then new.status in ('Accepted','Rejected','Cancelled')
    when 'Accepted' then new.status in ('Preparing','Cancelled')
    when 'Preparing' then new.status in ('Ready','Cancelled')
    when 'Ready' then new.status in ('Handed Over','Cancelled')
    when 'Handed Over' then new.status = 'Completed'
    else false
  end;

  if not allowed then
    raise exception 'Invalid order status transition: % -> %.', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_order_status_transition()
  from public, anon, authenticated;

drop trigger if exists enforce_order_status_transition_trigger
  on public.orders;
create trigger enforce_order_status_transition_trigger
before insert or update of status on public.orders
for each row
execute function public.enforce_order_status_transition();

create or replace function public.record_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history
      (order_id, restaurant_id, from_status, to_status, note, changed_by)
    values
      (new.id, new.restaurant_id, null, new.status,
       nullif(btrim(new.status_note), ''), auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_history
      (order_id, restaurant_id, from_status, to_status, note, changed_by)
    values
      (new.id, new.restaurant_id, old.status, new.status,
       nullif(btrim(new.status_note), ''), auth.uid());
  end if;

  return new;
end;
$$;

revoke execute on function public.record_order_status_history()
  from public, anon, authenticated;

drop trigger if exists record_order_status_history_trigger
  on public.orders;
create trigger record_order_status_history_trigger
after insert or update of status on public.orders
for each row
execute function public.record_order_status_history();

commit;

-- Verification: status-history table, policies, and current order statuses.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'order_status_history';

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'order_status_history';

select status, count(*) as order_count
from public.orders
group by status
order by status;
