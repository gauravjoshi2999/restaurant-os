-- Bite Cashbook: role and tenant isolation in isolated PostgreSQL 17 CI ONLY.
-- Applied after the staged cashbook migration to synthetic fixtures.
-- This script must never be run against Supabase production.
\set ON_ERROR_STOP on
begin;

-- Simulate independent identities and memberships instead of the single
-- hard-coded fixture owner. All changes, including the helper replacement,
-- are rolled back at the end of this script.
create table public.qa_cashbook_memberships(
 user_id uuid not null, restaurant_id uuid not null, member_role text not null,
 primary key (user_id,restaurant_id)
);
insert into public.qa_cashbook_memberships(user_id,restaurant_id,member_role) values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owner'),
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','manager'),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','staff'),
 ('66666666-6666-4666-8666-666666666666','99999999-9999-4999-8999-999999999999','owner');

create or replace function public.has_restaurant_role(target_restaurant uuid,allowed_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.qa_cashbook_memberships m
  where m.restaurant_id=target_restaurant
    and m.user_id=auth.uid()
    and m.member_role=any(allowed_roles)
 )
$$;

-- RLS fixture: closings available to owner/manager, not staff; POS payments
-- permitted to owner/manager/staff in their tenant; manual cashbook edits owner only.
drop policy if exists owner_closings_read on public.restaurant_cashbook_closings;
create policy qa_closings_read on public.restaurant_cashbook_closings
 for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner','manager']));
alter table public.restaurant_order_payments enable row level security;
create policy qa_payments_read on public.restaurant_order_payments
 for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']));
create policy qa_payments_insert on public.restaurant_order_payments
 for insert to authenticated
 with check(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']));
alter table public.restaurant_cashbook_manual_entries enable row level security;
create policy qa_manual_read on public.restaurant_cashbook_manual_entries
 for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner','manager']));
create policy qa_manual_insert on public.restaurant_cashbook_manual_entries
 for insert to authenticated
 with check(public.has_restaurant_role(restaurant_id,array['owner']));

-- A privileged source guard must run through its trigger, never as a directly
-- executable public / anonymous / authenticated RPC.
do $guard$
declare v_definer boolean;
begin
 select p.prosecdef into v_definer from pg_catalog.pg_proc p
 where p.oid='public.cashbook_guard_source_day()'::regprocedure;
 if v_definer is distinct from true then
  raise exception 'FAIL: cashbook source guard is not SECURITY DEFINER';
 end if;
 if pg_catalog.has_function_privilege('anon',
    'public.cashbook_guard_source_day()','EXECUTE') or
    pg_catalog.has_function_privilege('authenticated',
    'public.cashbook_guard_source_day()','EXECUTE') then
  raise exception 'FAIL: a client role can execute the privileged trigger function';
 end if;
end
$guard$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '11111111-1111-4111-8111-111111111111',true);

do $roles$
declare
 v_rest uuid := '22222222-2222-4222-8222-222222222222';
 v_other uuid := '99999999-9999-4999-8999-999999999999';
 v_n integer;
begin
 -- Original restaurant Owner can write a cash receipt and close its date.
 insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
 values(v_rest,'2099-12-18',50,'Cash');
 perform public.close_restaurant_cashbook_day(v_rest,'2099-12-18',100,150,null);
 select count(*) into v_n from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-18'
   and expected_cash=150 and cash_in=50 and counted_cash=150;
 if v_n<>1 then raise exception 'FAIL: owner close did not record cash accurately'; end if;

 -- Manager sees Owner's closing but may not close another date.
 perform pg_catalog.set_config('request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',true);
 select count(*) into v_n from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-18';
 if v_n<>1 then raise exception 'FAIL: manager cannot see own restaurant closing'; end if;
 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-17',0,0,null);
  raise exception 'FAIL: manager closed a cashbook day';
 exception when others then
  if sqlerrm not like '%Only Owner can close%' then raise; end if;
 end;

 -- Staff may record a permitted POS receipt for an OPEN day.
 -- The closed-day trigger still detects closing rows hidden by Staff RLS.
 perform pg_catalog.set_config('request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',true);
 select count(*) into v_n from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-18';
 if v_n<>0 then raise exception 'FAIL: staff can see a private closing'; end if;
 insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
 values(v_rest,'2099-12-16',2,'Cash');
 begin
  insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
  values(v_rest,'2099-12-18',1,'Cash');
  raise exception 'FAIL: staff inserted a late closed-day payment';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_cashbook_manual_entries
  (restaurant_id,entry_date,direction,category,amount,payment_method)
  values(v_rest,'2099-12-16','in','Not an owner',1,'Cash');
  raise exception 'FAIL: staff inserted a manual cashbook entry';
 exception when others then
  if sqlerrm not like '%row-level security%' then raise; end if;
 end;

 -- Completely unrelated logged-in user may not write another tenant's cash.
 perform pg_catalog.set_config('request.jwt.claim.sub',
  '55555555-5555-4555-8555-555555555555',true);
 begin
  insert into public.restaurant_order_payments(restaurant_id,payment_date,amount,payment_method)
  values(v_rest,'2099-12-16',3,'Cash');
  raise exception 'FAIL: outsider inserted a restaurant receipt';
 exception when others then
  if sqlerrm not like '%row-level security%' then raise; end if;
 end;

 -- Owner of restaurant B cannot see or close A, or write A's open-day cash.
 perform pg_catalog.set_config('request.jwt.claim.sub',
  '66666666-6666-4666-8666-666666666666',true);
 select count(*) into v_n from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-18';
 if v_n<>0 then raise exception 'FAIL: other restaurant Owner saw private closing'; end if;
 begin
  perform public.close_restaurant_cashbook_day(v_rest,'2099-12-15',0,0,null);
  raise exception 'FAIL: cross-restaurant Owner closed another restaurant';
 exception when others then
  if sqlerrm not like '%Only Owner can close%' then raise; end if;
 end;
 begin
  insert into public.restaurant_cashbook_manual_entries
  (restaurant_id,entry_date,direction,category,amount,payment_method)
  values(v_rest,'2099-12-16','in','Foreign manual entry',1,'Cash');
  raise exception 'FAIL: cross-restaurant Owner inserted manual cash';
 exception when others then
  if sqlerrm not like '%row-level security%' then raise; end if;
 end;

 -- Own restaurant B remains independent and usable.
 insert into public.restaurant_cashbook_manual_entries
  (restaurant_id,entry_date,direction,category,amount,payment_method)
 values(v_other,'2099-12-15','in','Restaurant B cash',5,'Cash');
 perform public.close_restaurant_cashbook_day(v_other,'2099-12-15',10,15,null);
 select count(*) into v_n from public.restaurant_cashbook_closings
 where restaurant_id=v_other and close_date='2099-12-15'
   and cash_in=5 and expected_cash=15;
 if v_n<>1 then raise exception 'FAIL: unrelated restaurant cannot close its own cashbook'; end if;
 raise notice 'PASS: Owner/Manager/Staff/cross-tenant RLS and privileged guard behavior';
end
$roles$;
rollback;
