-- Daily cashbook and owner day-closing ledger.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- This file is the reproducible reference patch; the live schema is authoritative.

create table if not exists public.restaurant_cashbook_manual_entries (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 entry_date date not null default current_date,
 direction text not null check(direction in ('in','out')),
 category text not null check(length(btrim(category)) between 1 and 80),
 amount numeric(14,2) not null check(amount>0),
 payment_method text not null check(payment_method in ('Cash','UPI','Card','Bank Transfer','Other')),
 description text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists restaurant_cashbook_manual_rest_date_idx on public.restaurant_cashbook_manual_entries(restaurant_id,entry_date desc);
create index if not exists restaurant_cashbook_manual_created_by_idx on public.restaurant_cashbook_manual_entries(created_by);
alter table public.restaurant_cashbook_manual_entries enable row level security;
drop policy if exists "Cashbook manual members read" on public.restaurant_cashbook_manual_entries;
create policy "Cashbook manual members read" on public.restaurant_cashbook_manual_entries for select to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Cashbook manual owners insert" on public.restaurant_cashbook_manual_entries;
create policy "Cashbook manual owners insert" on public.restaurant_cashbook_manual_entries for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner']) and created_by=(select auth.uid()));
drop policy if exists "Cashbook manual owners update" on public.restaurant_cashbook_manual_entries;
create policy "Cashbook manual owners update" on public.restaurant_cashbook_manual_entries for update to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner']))
with check(public.has_restaurant_role(restaurant_id,array['owner']) and created_by=(select auth.uid()));
drop policy if exists "Cashbook manual owners delete" on public.restaurant_cashbook_manual_entries;
create policy "Cashbook manual owners delete" on public.restaurant_cashbook_manual_entries for delete to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner']));

create table if not exists public.restaurant_cashbook_closings (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 close_date date not null,
 opening_cash numeric(14,2) not null default 0 check(opening_cash>=0),
 cash_in numeric(14,2) not null default 0 check(cash_in>=0),
 cash_out numeric(14,2) not null default 0 check(cash_out>=0),
 expected_cash numeric(14,2) not null default 0,
 counted_cash numeric(14,2) not null check(counted_cash>=0),
 difference numeric(14,2) not null,
 notes text,
 closed_by uuid not null default auth.uid() references auth.users(id),
 closed_at timestamptz not null default now(),
 unique(restaurant_id,close_date)
);
create index if not exists restaurant_cashbook_closings_rest_date_idx on public.restaurant_cashbook_closings(restaurant_id,close_date desc);
create index if not exists restaurant_cashbook_closings_closed_by_idx on public.restaurant_cashbook_closings(closed_by);
alter table public.restaurant_cashbook_closings enable row level security;
drop policy if exists "Cashbook closings members read" on public.restaurant_cashbook_closings;
create policy "Cashbook closings members read" on public.restaurant_cashbook_closings for select to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Cashbook closings owners insert" on public.restaurant_cashbook_closings;
create policy "Cashbook closings owners insert" on public.restaurant_cashbook_closings for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner']) and closed_by=(select auth.uid()));

create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as
select e.id as entry_id,e.restaurant_id,e.expense_date as entry_date,'out'::text as direction,
 e.category,e.amount,e.payment_method,e.title as description,'expense'::text as source_type,e.id as source_id,e.created_at
from public.restaurant_expenses e
union all
select p.id,p.restaurant_id,p.purchase_date,'out'::text,'Purchase payment'::text,p.paid_amount,p.payment_method,
 coalesce(s.name,p.supplier_name_snapshot,'Purchase payment')::text,'purchase'::text,p.id,p.created_at
from public.restaurant_purchases p
left join public.restaurant_suppliers s on s.id=p.supplier_id
where p.paid_amount>0
union all
select m.id,m.restaurant_id,m.entry_date,m.direction,m.category,m.amount,m.payment_method,
 coalesce(m.description,m.category),'manual'::text,m.id,m.created_at
from public.restaurant_cashbook_manual_entries m;
grant select on public.restaurant_cashbook_entries to authenticated;
grant select,insert,update,delete on public.restaurant_cashbook_manual_entries to authenticated;
grant select,insert on public.restaurant_cashbook_closings to authenticated;

create or replace function public.guard_cashbook_manual_entry()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.restaurant_id is distinct from old.restaurant_id or new.created_by is distinct from old.created_by) then
  raise exception 'Cashbook entry ownership fields are immutable';
 end if;
 if exists(select 1 from public.restaurant_cashbook_closings c
   where c.restaurant_id=coalesce(new.restaurant_id,old.restaurant_id)
     and c.close_date=coalesce(new.entry_date,old.entry_date))
  or (tg_op='UPDATE' and exists(select 1 from public.restaurant_cashbook_closings c
   where c.restaurant_id=old.restaurant_id and c.close_date=old.entry_date)) then
  raise exception 'This cashbook day is already closed';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists restaurant_cashbook_manual_guard on public.restaurant_cashbook_manual_entries;
create trigger restaurant_cashbook_manual_guard before insert or update or delete on public.restaurant_cashbook_manual_entries
for each row execute function public.guard_cashbook_manual_entry();

create or replace function public.set_cashbook_manual_updated_at()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists restaurant_cashbook_manual_updated_at on public.restaurant_cashbook_manual_entries;
create trigger restaurant_cashbook_manual_updated_at before update on public.restaurant_cashbook_manual_entries
for each row execute function public.set_cashbook_manual_updated_at();

create or replace function public.guard_cashbook_source_date()
returns trigger language plpgsql set search_path='' as $$
declare rid uuid; d date;
begin
 if tg_table_name='restaurant_expenses' then
  if tg_op='INSERT' then rid:=new.restaurant_id; d:=new.expense_date;
  elsif tg_op='UPDATE' then
   if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=old.restaurant_id and c.close_date=old.expense_date)
    or exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.expense_date) then raise exception 'This cashbook day is already closed'; end if;
   return new;
  else rid:=old.restaurant_id; d:=old.expense_date; end if;
 else
  if tg_op='INSERT' then rid:=new.restaurant_id; d:=new.purchase_date;
  elsif tg_op='UPDATE' then
   if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=old.restaurant_id and c.close_date=old.purchase_date)
    or exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.purchase_date) then raise exception 'This cashbook day is already closed'; end if;
   return new;
  else rid:=old.restaurant_id; d:=old.purchase_date; end if;
 end if;
 if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=rid and c.close_date=d) then raise exception 'This cashbook day is already closed'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists restaurant_expenses_cashbook_lock on public.restaurant_expenses;
create trigger restaurant_expenses_cashbook_lock before insert or update or delete on public.restaurant_expenses
for each row execute function public.guard_cashbook_source_date();
drop trigger if exists restaurant_purchases_cashbook_lock on public.restaurant_purchases;
create trigger restaurant_purchases_cashbook_lock before insert or update or delete on public.restaurant_purchases
for each row execute function public.guard_cashbook_source_date();

create or replace function public.calculate_cashbook_closing()
returns trigger language plpgsql set search_path='' as $$
declare v_in numeric(14,2); v_out numeric(14,2);
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner']) then raise exception 'Only Owner can close the cashbook day'; end if;
 select coalesce(sum(case when direction='in' then amount else 0 end),0),
        coalesce(sum(case when direction='out' then amount else 0 end),0)
 into v_in,v_out from public.restaurant_cashbook_entries
 where restaurant_id=new.restaurant_id and entry_date=new.close_date and payment_method='Cash';
 new.cash_in:=v_in;new.cash_out:=v_out;new.expected_cash:=new.opening_cash+v_in-v_out;
 new.difference:=new.counted_cash-new.expected_cash;new.closed_by:=auth.uid();new.closed_at:=now();
 return new;
end;
$$;
drop trigger if exists restaurant_cashbook_closing_calculate on public.restaurant_cashbook_closings;
create trigger restaurant_cashbook_closing_calculate before insert on public.restaurant_cashbook_closings
for each row execute function public.calculate_cashbook_closing();

create or replace function public.close_restaurant_cashbook_day(
 p_restaurant_id uuid,p_close_date date,p_opening_cash numeric,p_counted_cash numeric,p_notes text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_in numeric(14,2);v_out numeric(14,2);v_expected numeric(14,2);v_id uuid;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner']) then raise exception 'Only Owner can close the cashbook day'; end if;
 if p_opening_cash<0 or p_counted_cash<0 then raise exception 'Cash amounts cannot be negative'; end if;
 select coalesce(sum(case when direction='in' then amount else 0 end),0),
        coalesce(sum(case when direction='out' then amount else 0 end),0)
 into v_in,v_out from public.restaurant_cashbook_entries
 where restaurant_id=p_restaurant_id and entry_date=p_close_date and payment_method='Cash';
 v_expected:=p_opening_cash+v_in-v_out;
 insert into public.restaurant_cashbook_closings(restaurant_id,close_date,opening_cash,cash_in,cash_out,expected_cash,counted_cash,difference,notes,closed_by)
 values(p_restaurant_id,p_close_date,p_opening_cash,v_in,v_out,v_expected,p_counted_cash,p_counted_cash-v_expected,nullif(p_notes,''),auth.uid())
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.close_restaurant_cashbook_day(uuid,date,numeric,numeric,text) from public,anon;
grant execute on function public.close_restaurant_cashbook_day(uuid,date,numeric,numeric,text) to authenticated;

-- Closing rows are immutable once written; manual rows remain Owner-managed.
revoke update,delete on public.restaurant_cashbook_closings from authenticated,anon;
