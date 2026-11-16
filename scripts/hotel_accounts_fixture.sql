create table if not exists public.restaurant_cashbook_closings(restaurant_id uuid,close_date date);
alter table public.restaurant_order_payments add column if not exists created_at timestamptz default now();
alter table public.restaurant_order_refunds add column if not exists created_at timestamptz default now();
-- Synthetic richer cashbook view for the NEW account tests only.
-- Loaded after all existing property suites have completed.
alter table public.restaurant_cashbook_manual_entries add column category text default 'Other';
alter table public.restaurant_cashbook_manual_entries add column description text default '';
alter table public.restaurant_employee_payments add column payment_type text default 'Salary';
alter table public.restaurant_employee_payments add column employee_id uuid;
create table public.restaurant_employees(id uuid primary key,restaurant_id uuid,full_name text);
create or replace view public.restaurant_cashbook_entries as
 select p.id entry_id,p.restaurant_id,p.payment_date entry_date,'in'::text direction,p.amount::numeric(14,2)amount,p.payment_method,
 'Order payment'::text category,coalesce(o.order_code,'Order')description,'order_payment'::text source_type,p.id source_id,p.created_at
 from public.restaurant_order_payments p join public.orders o on o.id=p.order_id
 union all select id,restaurant_id,expense_date,'out',amount::numeric(14,2),payment_method,category,title,'expense',id,created_at from public.restaurant_expenses
 union all select id,restaurant_id,purchase_date,'out',paid_amount::numeric(14,2),payment_method,'Purchase payment','Purchase payment','purchase',id,created_at from public.restaurant_purchases where paid_amount>0
 union all select id,restaurant_id,entry_date,direction,amount::numeric(14,2),payment_method,category,description,'manual',id,created_at from public.restaurant_cashbook_manual_entries
 union all select p.id,p.restaurant_id,p.payment_date,'out',p.amount::numeric(14,2),p.payment_method,'Employee '||p.payment_type,coalesce(e.full_name,'Employee')||' · '||p.payment_type,'employee_payment',p.id,p.created_at from public.restaurant_employee_payments p left join public.restaurant_employees e on e.id=p.employee_id
 union all select id,restaurant_id,entry_date,'in',amount::numeric(14,2),payment_method,'Customer collection','Customer collection','customer_ledger_payment',id,created_at from public.restaurant_customer_ledger_entries where entry_type='credit'
 union all select id,restaurant_id,refund_date,'out',refund_amount::numeric(14,2),payment_method,'Customer refund','Customer refund','order_refund',id,created_at from public.restaurant_order_refunds where refund_amount>0;
