-- Bite Cashbook production preflight — READ ONLY. No financial mutations.
-- Run with an authorized database administrator before an approved migration.
-- This script reports compatibility; it does not deploy or certify a release.
begin transaction read only;

-- Exact seven ledger-source columns, RLS flags and existing triggers.
with expected(table_name,date_column) as (values
 ('restaurant_expenses','expense_date'),
 ('restaurant_purchases','purchase_date'),
 ('restaurant_cashbook_manual_entries','entry_date'),
 ('restaurant_order_payments','payment_date'),
 ('restaurant_employee_payments','payment_date'),
 ('restaurant_customer_ledger_entries','entry_date'),
 ('restaurant_order_refunds','refund_date')
)
select e.table_name,e.date_column,
 coalesce(format_type(a.atttypid,a.atttypmod),'MISSING') as column_type,
 coalesce(c.relrowsecurity,false) as rls_enabled,
 (select count(*) from pg_catalog.pg_trigger t
   where t.tgrelid=c.oid and not t.tgisinternal
     and t.tgname='cashbook_day_serialization_guard') as serialization_trigger_count,
 (select pg_catalog.string_agg(t.tgname,', ' order by t.tgname)
   from pg_catalog.pg_trigger t
   where t.tgrelid=c.oid and not t.tgisinternal) as existing_triggers
from expected e
left join pg_catalog.pg_class c
 on c.relname=e.table_name and c.relnamespace='public'::regnamespace
left join pg_catalog.pg_attribute a
 on a.attrelid=c.oid and a.attname=e.date_column and not a.attisdropped
order by e.table_name;

-- Expected closing RPC signature and names of overwritten functions.
select p.oid::pg_catalog.regprocedure as signature,p.prosecdef as security_definer,
 md5(pg_catalog.pg_get_functiondef(p.oid)) as current_definition_fingerprint
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('close_restaurant_cashbook_day',
    'calculate_cashbook_closing','cashbook_guard_source_day')
order by p.proname;

-- Review whether there are pre-existing closings with ledger drift.
-- Return aggregate counts only; not customer or financial details.
with cash as (
 select e.restaurant_id,e.entry_date,
  coalesce(sum(e.amount) filter(where e.payment_method='Cash' and e.direction='in'),0) as cash_in,
  coalesce(sum(e.amount) filter(where e.payment_method='Cash' and e.direction='out'),0) as cash_out
 from public.restaurant_cashbook_entries e
 group by e.restaurant_id,e.entry_date
)
select count(*) as closed_days,
 count(*) filter (
  where c.cash_in is distinct from coalesce(x.cash_in,0)
     or c.cash_out is distinct from coalesce(x.cash_out,0)
     or c.expected_cash is distinct from
       c.opening_cash+coalesce(x.cash_in,0)-coalesce(x.cash_out,0)
 ) as ledger_drift_days
from public.restaurant_cashbook_closings c
left join cash x on x.restaurant_id=c.restaurant_id and x.entry_date=c.close_date;

-- An authorized release manager must separately capture the exact original
-- definitions of calculate_cashbook_closing() and
-- close_restaurant_cashbook_day(uuid,date,numeric,numeric,text),
-- plus a verified database backup/restore point, BEFORE any rollout.
-- Dropping the seven new triggers alone does not restore those overwritten RPCs.
rollback;
