-- Bite Owner P0-3b: serialize source writes and day closing on the SAME restaurant/day lock.
-- Migration for review/staging only. Do NOT apply to production before integration QA.
-- Live schema verified read-only on 2026-11-13 (PostgreSQL 17.11).
--
-- Ledger sources (view public.restaurant_cashbook_entries):
-- expenses(expense_date), purchases(purchase_date), manual(entry_date),
-- POS payments(payment_date), employee payments(payment_date),
-- customer ledger collections(entry_date), POS refunds(refund_date).
--
-- A 64-bit hash collision only serializes unrelated days; it cannot permit a bypass.
-- Both source triggers and the closing trigger use the identical namespace/key.
-- Multi-day UPDATE locks keys in signed BIGINT order, avoiding reverse-date deadlocks.

create or replace function public.cashbook_guard_source_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_old_rest uuid;
 v_new_rest uuid;
 v_old_day date;
 v_new_day date;
 v_old_key bigint;
 v_new_key bigint;
begin
 -- Fixed allowlist: no caller-controlled table or column names.
 if tg_table_schema <> 'public'
    or (tg_table_name, tg_argv[0]) not in (
      ('restaurant_expenses','expense_date'),
      ('restaurant_purchases','purchase_date'),
      ('restaurant_cashbook_manual_entries','entry_date'),
      ('restaurant_order_payments','payment_date'),
      ('restaurant_employee_payments','payment_date'),
      ('restaurant_customer_ledger_entries','entry_date'),
      ('restaurant_order_refunds','refund_date')
    ) then
  raise exception 'Unsupported cashbook source trigger';
 end if;

 if tg_op <> 'INSERT' then
  v_old_rest := old.restaurant_id;
  v_old_day := (pg_catalog.to_jsonb(old)->>tg_argv[0])::date;
  if v_old_rest is null or v_old_day is null then
   raise exception 'Cashbook source restaurant/date required';
  end if;
  v_old_key := pg_catalog.hashtextextended(
    'bite.cashbook.day.v1|' || v_old_rest::text || '|' || v_old_day::text, 0::bigint);
 end if;
 if tg_op <> 'DELETE' then
  v_new_rest := new.restaurant_id;
  v_new_day := (pg_catalog.to_jsonb(new)->>tg_argv[0])::date;
  if v_new_rest is null or v_new_day is null then
   raise exception 'Cashbook source restaurant/date required';
  end if;
  v_new_key := pg_catalog.hashtextextended(
    'bite.cashbook.day.v1|' || v_new_rest::text || '|' || v_new_day::text, 0::bigint);
 end if;

 -- UPDATE can move a source between days/tenants. Lock BOTH in a stable order.
 if v_old_key is not null and v_new_key is not null then
  perform pg_catalog.pg_advisory_xact_lock(least(v_old_key,v_new_key));
  if v_old_key <> v_new_key then
   perform pg_catalog.pg_advisory_xact_lock(greatest(v_old_key,v_new_key));
  end if;
 elsif v_old_key is not null then
  perform pg_catalog.pg_advisory_xact_lock(v_old_key);
 else
  perform pg_catalog.pg_advisory_xact_lock(v_new_key);
 end if;

 -- SECURITY DEFINER is intentional: staff may INSERT payments/khata entries
 -- but RLS does not let staff SELECT the closings table. The guard must see it.
 if v_old_rest is not null and exists(
   select 1 from public.restaurant_cashbook_closings c
   where c.restaurant_id=v_old_rest and c.close_date=v_old_day
 ) then
  raise exception 'This cashbook day is already closed';
 end if;
 if v_new_rest is not null and exists(
   select 1 from public.restaurant_cashbook_closings c
   where c.restaurant_id=v_new_rest and c.close_date=v_new_day
 ) then
  raise exception 'This cashbook day is already closed';
 end if;

 if tg_op = 'DELETE' then return old; end if;
 return new;
end;
$$;

-- Trigger functions are not a public RPC API. Triggers continue to execute
-- as the table owner even though direct EXECUTE is revoked.
revoke all on function public.cashbook_guard_source_day() from public, anon, authenticated;

-- Name sorts before pre-existing restaurant_* guards, so the lock is acquired
-- before those guards check closed-day status or take their own row locks.
drop trigger if exists cashbook_day_serialization_guard on public.restaurant_expenses;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_expenses
for each row execute function public.cashbook_guard_source_day('expense_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_purchases;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_purchases
for each row execute function public.cashbook_guard_source_day('purchase_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_cashbook_manual_entries;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_cashbook_manual_entries
for each row execute function public.cashbook_guard_source_day('entry_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_order_payments;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_order_payments
for each row execute function public.cashbook_guard_source_day('payment_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_employee_payments;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_employee_payments
for each row execute function public.cashbook_guard_source_day('payment_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_customer_ledger_entries;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_customer_ledger_entries
for each row execute function public.cashbook_guard_source_day('entry_date');

drop trigger if exists cashbook_day_serialization_guard on public.restaurant_order_refunds;
create trigger cashbook_day_serialization_guard
before insert or update or delete on public.restaurant_order_refunds
for each row execute function public.cashbook_guard_source_day('refund_date');

-- The existing closing INSERT trigger is the single source of truth for
-- cash totals. Guard direct table INSERTs as well as the RPC, under the SAME
-- transaction advisory lock as every source write.
create or replace function public.calculate_cashbook_closing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
 v_in numeric(14,2);
 v_out numeric(14,2);
begin
 if auth.uid() is null
    or not public.has_restaurant_role(new.restaurant_id,array['owner']) then
  raise exception 'Only Owner can close the cashbook day';
 end if;
 if new.restaurant_id is null or new.close_date is null then
  raise exception 'Restaurant and closing date are required';
 end if;
 if new.opening_cash is null or new.counted_cash is null
    or new.opening_cash::text in ('NaN','Infinity','-Infinity')
    or new.counted_cash::text in ('NaN','Infinity','-Infinity')
    or new.opening_cash < 0 or new.counted_cash < 0
    or new.opening_cash <> pg_catalog.round(new.opening_cash,2)
    or new.counted_cash <> pg_catalog.round(new.counted_cash,2) then
  raise exception 'Cash amounts must be finite non-negative rupees with at most two decimals';
 end if;
 if pg_catalog.length(pg_catalog.btrim(coalesce(new.notes,''))) > 1000 then
  raise exception 'Cash closing note is too long';
 end if;

 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'bite.cashbook.day.v1|' || new.restaurant_id::text || '|' || new.close_date::text, 0::bigint));

 select coalesce(sum(case when direction='in' then amount else 0 end),0),
        coalesce(sum(case when direction='out' then amount else 0 end),0)
 into v_in,v_out
 from public.restaurant_cashbook_entries
 where restaurant_id=new.restaurant_id and entry_date=new.close_date
   and payment_method='Cash';

 new.cash_in := v_in;
 new.cash_out := v_out;
 new.expected_cash := new.opening_cash + v_in - v_out;
 if new.expected_cash < 0 then
  raise exception 'Expected drawer cash cannot be negative; check opening cash and outflows';
 end if;
 new.difference := new.counted_cash - new.expected_cash;
 new.notes := nullif(pg_catalog.btrim(coalesce(new.notes,'')),'');
 if new.difference <> 0 and pg_catalog.length(coalesce(new.notes,'')) < 8 then
  raise exception 'Cash difference requires a reason of at least 8 characters';
 end if;
 new.closed_by := auth.uid();
 new.closed_at := now();
 return new;
end;
$$;

-- Keep the existing RPC signature and uuid return type: PR #20 and current
-- Owner clients can call it without any API changes.
create or replace function public.close_restaurant_cashbook_day(
 p_restaurant_id uuid,
 p_close_date date,
 p_opening_cash numeric,
 p_counted_cash numeric,
 p_notes text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
 v_existing public.restaurant_cashbook_closings%rowtype;
 v_id uuid;
 v_note text;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if p_restaurant_id is null or p_close_date is null then
  raise exception 'Restaurant and closing date are required';
 end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner']) then
  raise exception 'Only Owner can close the cashbook day';
 end if;
 if p_opening_cash is null or p_counted_cash is null
    or p_opening_cash::text in ('NaN','Infinity','-Infinity')
    or p_counted_cash::text in ('NaN','Infinity','-Infinity')
    or p_opening_cash < 0 or p_counted_cash < 0
    or p_opening_cash <> pg_catalog.round(p_opening_cash,2)
    or p_counted_cash <> pg_catalog.round(p_counted_cash,2) then
  raise exception 'Cash amounts must be finite non-negative rupees with at most two decimals';
 end if;
 v_note := nullif(pg_catalog.btrim(coalesce(p_notes,'')),'');
 if pg_catalog.length(coalesce(v_note,'')) > 1000 then
  raise exception 'Cash closing note is too long';
 end if;

 -- Lock before reading existing closing or ledger; no duplicate close on retry.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'bite.cashbook.day.v1|' || p_restaurant_id::text || '|' || p_close_date::text, 0::bigint));
 select * into v_existing
 from public.restaurant_cashbook_closings c
 where c.restaurant_id=p_restaurant_id and c.close_date=p_close_date;
 if found then
  if v_existing.opening_cash=p_opening_cash
     and v_existing.counted_cash=p_counted_cash
     and coalesce(pg_catalog.btrim(v_existing.notes),'')=coalesce(v_note,'') then
   return v_existing.id; -- identical retry: no new row or changed audit fields
  end if;
  raise exception 'This cashbook day is already closed with different values';
 end if;

 -- BEFORE INSERT trigger rechecks the cash totals and discrepancy under lock.
 insert into public.restaurant_cashbook_closings
   (restaurant_id,close_date,opening_cash,counted_cash,notes,closed_by)
 values (p_restaurant_id,p_close_date,p_opening_cash,p_counted_cash,v_note,auth.uid())
 returning id into v_id;
 return v_id;
end;
$$;

revoke all on function public.close_restaurant_cashbook_day(uuid,date,numeric,numeric,text)
 from public,anon;
grant execute on function public.close_restaurant_cashbook_day(uuid,date,numeric,numeric,text)
 to authenticated;
