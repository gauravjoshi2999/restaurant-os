-- No-cost PostgreSQL CI: simulate production cashbook VIEW projections using
-- metadata verified READ-ONLY against live Supabase on 2026-11-13.
-- Runs in an ephemeral GitHub Actions database only; ALL writes roll back.
-- This is stronger than the minimal fixture, but is NOT full Supabase staging.
\set ON_ERROR_STOP on
begin;

-- Existing lightweight fixture does not model these real linked tables/fields.
create table public.orders(id uuid primary key, restaurant_id uuid not null);
create table public.restaurant_employees(id uuid primary key, restaurant_id uuid not null);
create table public.restaurant_customers(id uuid primary key, restaurant_id uuid not null);
alter table public.restaurant_purchases add column paid_amount numeric(14,2) default 0;
alter table public.restaurant_order_payments add column order_id uuid;
alter table public.restaurant_employee_payments add column employee_id uuid,
 add column payment_type text;
alter table public.restaurant_customer_ledger_entries add column customer_id uuid,
 add column entry_type text;
alter table public.restaurant_order_refunds add column order_id uuid,
 add column refund_amount numeric(14,2) default 0;
grant select on public.orders,public.restaurant_employees,public.restaurant_customers to authenticated;

-- Match the real seven-source cashbook's key JOINs/FILTERs and invoker mode.
-- Only the five columns consumed by the closing function are projected here.
create or replace view public.restaurant_cashbook_entries
with (security_invoker=true) as
 select e.restaurant_id,e.expense_date as entry_date,'out'::text as direction,
        e.amount,e.payment_method
 from public.restaurant_expenses e
 union all
 select p.restaurant_id,p.purchase_date,'out'::text,
        p.paid_amount,p.payment_method
 from public.restaurant_purchases p
 where p.paid_amount>0
 union all
 select m.restaurant_id,m.entry_date,m.direction,m.amount,m.payment_method
 from public.restaurant_cashbook_manual_entries m
 union all
 select p.restaurant_id,p.payment_date,'in'::text,p.amount,p.payment_method
 from public.restaurant_order_payments p
 join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
 union all
 select ep.restaurant_id,ep.payment_date,'out'::text,ep.amount,ep.payment_method
 from public.restaurant_employee_payments ep
 join public.restaurant_employees e on e.id=ep.employee_id and e.restaurant_id=ep.restaurant_id
 where ep.payment_type in ('Salary','Advance','Bonus')
 union all
 select l.restaurant_id,l.entry_date,'in'::text,l.amount,l.payment_method
 from public.restaurant_customer_ledger_entries l
 join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
 where l.entry_type='credit'
 union all
 select r.restaurant_id,r.refund_date,'out'::text,r.refund_amount,r.payment_method
 from public.restaurant_order_refunds r
 join public.orders o on o.id=r.order_id and o.restaurant_id=r.restaurant_id
 where r.refund_amount>0;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
 '11111111-1111-4111-8111-111111111111',true);

do $test$
declare
 v_rest uuid:='22222222-2222-4222-8222-222222222222';
 v_other uuid:='99999999-9999-4999-8999-999999999999';
 v_order uuid:='44444444-4444-4444-8444-444444444444';
 v_employee uuid:='55555555-5555-4555-8555-555555555555';
 v_customer uuid:='66666666-6666-4666-8666-666666666666';
 v_date date:='2099-12-23';
 v_view_option boolean;
 v_count int;
begin
 select coalesce('security_invoker=true'=any(c.reloptions),false)
 into v_view_option from pg_catalog.pg_class c
 where c.oid='public.restaurant_cashbook_entries'::regclass;
 if not v_view_option then raise exception 'Cashbook view must be SECURITY INVOKER'; end if;

 insert into public.orders(id,restaurant_id) values(v_order,v_rest);
 insert into public.restaurant_employees(id,restaurant_id) values(v_employee,v_rest);
 insert into public.restaurant_customers(id,restaurant_id) values(v_customer,v_rest);

 -- The seven actual visible cashbook sources:
 insert into public.restaurant_expenses(restaurant_id,expense_date,amount,payment_method)
 values(v_rest,v_date,7,'Cash');
 insert into public.restaurant_purchases(restaurant_id,purchase_date,amount,paid_amount,payment_method)
 values(v_rest,v_date,100,3,'Cash'); -- only PAID 3, not whole invoice 100
 insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
 values(v_rest,v_date,'in','Test receipt',5,'Cash');
 insert into public.restaurant_order_payments(restaurant_id,order_id,payment_date,amount,payment_method)
 values(v_rest,v_order,v_date,40,'Cash');
 insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,payment_type,amount,payment_method)
 values(v_rest,v_employee,v_date,'Salary',11,'Cash');
 insert into public.restaurant_customer_ledger_entries(restaurant_id,customer_id,entry_date,entry_type,amount,payment_method)
 values(v_rest,v_customer,v_date,'credit',9,'Cash');
 insert into public.restaurant_order_refunds(restaurant_id,order_id,refund_date,amount,refund_amount,payment_method)
 values(v_rest,v_order,v_date,13,13,'Cash');

 -- Explicitly excluded by REAL production view / closing filters:
 insert into public.restaurant_purchases(restaurant_id,purchase_date,amount,paid_amount,payment_method)
 values(v_rest,v_date,800,0,'Cash');
 insert into public.restaurant_order_payments(restaurant_id,order_id,payment_date,amount,payment_method)
 values(v_rest,'77777777-7777-4777-8777-777777777777',v_date,900,'Cash');
 insert into public.restaurant_order_payments(restaurant_id,order_id,payment_date,amount,payment_method)
 values(v_rest,v_order,v_date,700,'UPI');
 insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,payment_type,amount,payment_method)
 values(v_rest,v_employee,v_date,'Uniform',500,'Cash');
 insert into public.restaurant_customer_ledger_entries(restaurant_id,customer_id,entry_date,entry_type,amount,payment_method)
 values(v_rest,v_customer,v_date,'debit',600,'Cash');
 insert into public.restaurant_order_refunds(restaurant_id,order_id,refund_date,amount,refund_amount,payment_method)
 values(v_rest,v_order,v_date,200,0,'Cash');
 insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
 values(v_other,v_date,'in','Other tenant',300,'Cash');

 select count(*) into v_count from public.restaurant_cashbook_entries
 where restaurant_id=v_rest and entry_date=v_date and payment_method='Cash';
 if v_count<>7 then raise exception 'Expected EXACTLY seven included cash records, got %',v_count; end if;

 perform public.close_restaurant_cashbook_day(v_rest,v_date,100,120,null);
 select count(*) into v_count from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date=v_date
   and cash_in=54 and cash_out=34 and expected_cash=120
   and counted_cash=120 and difference=0;
 if v_count<>1 then raise exception 'Real-view cash closing totals incorrect'; end if;

 -- Every source must be protected after closing, not only manual entries.
 begin
  insert into public.restaurant_expenses(restaurant_id,expense_date,amount,payment_method)
  values(v_rest,v_date,1,'Cash');
  raise exception 'FAIL expenses closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_purchases(restaurant_id,purchase_date,amount,paid_amount,payment_method)
  values(v_rest,v_date,1,1,'Cash');
  raise exception 'FAIL purchases closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_order_payments(restaurant_id,order_id,payment_date,amount,payment_method)
  values(v_rest,v_order,v_date,1,'Cash');
  raise exception 'FAIL POS closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,payment_type,amount,payment_method)
  values(v_rest,v_employee,v_date,'Salary',1,'Cash');
  raise exception 'FAIL staff payment closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_customer_ledger_entries(restaurant_id,customer_id,entry_date,entry_type,amount,payment_method)
  values(v_rest,v_customer,v_date,'credit',1,'Cash');
  raise exception 'FAIL khata closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_order_refunds(restaurant_id,order_id,refund_date,amount,refund_amount,payment_method)
  values(v_rest,v_order,v_date,1,1,'Cash');
  raise exception 'FAIL refund closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;
 begin
  insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,direction,category,amount,payment_method)
  values(v_rest,v_date,'in','Manual adjustment',1,'Cash');
  raise exception 'FAIL manual closed-date bypass';
 exception when others then
  if sqlerrm not like '%already closed%' then raise; end if;
 end;

 -- A direct INSERT into closing table must not allow forged totals.
 insert into public.restaurant_cashbook_closings(
  restaurant_id,close_date,opening_cash,cash_in,cash_out,expected_cash,counted_cash,difference,closed_by)
 values (v_rest,'2099-12-22',10,999,999,999,10,999,auth.uid());
 select count(*) into v_count from public.restaurant_cashbook_closings
 where restaurant_id=v_rest and close_date='2099-12-22'
   and cash_in=0 and cash_out=0 and expected_cash=10 and difference=0;
 if v_count<>1 then raise exception 'Direct closing forged totals not overwritten'; end if;

 raise notice 'PASS: production-view parity, seven true sources, excluded rows, CASH-only, seven closed-day guards, forged totals';
end;
$test$;
rollback;
