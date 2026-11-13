-- Synthetic PostgreSQL 17 fixture for CI. Not the live Supabase schema.
-- Execute ONLY in an ephemeral test database, before the migration.
create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
do $ begin create role authenticated nologin; exception when duplicate_object then null; end $;
do $ begin create role anon nologin; exception when duplicate_object then null; end $;
grant usage on schema auth,public to authenticated;
grant execute on function auth.uid() to authenticated;

create or replace function public.has_restaurant_role(target_restaurant uuid,allowed_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select target_restaurant='22222222-2222-4222-8222-222222222222'::uuid
    and auth.uid()='11111111-1111-4111-8111-111111111111'::uuid
    and 'owner'=any(allowed_roles)
$$;
grant execute on function public.has_restaurant_role(uuid,text[]) to authenticated;

create table public.restaurant_cashbook_closings(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null,
 close_date date not null,
 opening_cash numeric(14,2) not null default 0,
 cash_in numeric(14,2) not null default 0,
 cash_out numeric(14,2) not null default 0,
 expected_cash numeric(14,2) not null default 0,
 counted_cash numeric(14,2) not null,
 difference numeric(14,2) not null,
 notes text,
 closed_by uuid not null,
 closed_at timestamptz not null default now(),
 unique(restaurant_id,close_date)
);
alter table public.restaurant_cashbook_closings enable row level security;
create policy owner_closings_read on public.restaurant_cashbook_closings
for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']));
create policy owner_closings_insert on public.restaurant_cashbook_closings
for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner']));
grant select,insert on public.restaurant_cashbook_closings to authenticated;

create table public.restaurant_expenses(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 expense_date date not null,amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_purchases(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 purchase_date date not null,amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_cashbook_manual_entries(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 entry_date date not null,direction text not null,category text not null,
 amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_order_payments(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 payment_date date not null,amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_employee_payments(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 payment_date date not null,amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_customer_ledger_entries(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 entry_date date not null,amount numeric(14,2) not null,payment_method text not null
);
create table public.restaurant_order_refunds(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 refund_date date not null,amount numeric(14,2) not null,payment_method text not null
);
grant select,insert,update,delete on public.restaurant_expenses,
 public.restaurant_purchases,public.restaurant_cashbook_manual_entries,
 public.restaurant_order_payments,public.restaurant_employee_payments,
 public.restaurant_customer_ledger_entries,public.restaurant_order_refunds to authenticated;

create view public.restaurant_cashbook_entries as
 select restaurant_id,expense_date as entry_date,'out'::text as direction,amount,payment_method from public.restaurant_expenses
 union all select restaurant_id,purchase_date,'out',amount,payment_method from public.restaurant_purchases
 union all select restaurant_id,entry_date,direction,amount,payment_method from public.restaurant_cashbook_manual_entries
 union all select restaurant_id,payment_date,'in',amount,payment_method from public.restaurant_order_payments
 union all select restaurant_id,payment_date,'out',amount,payment_method from public.restaurant_employee_payments
 union all select restaurant_id,entry_date,'in',amount,payment_method from public.restaurant_customer_ledger_entries
 union all select restaurant_id,refund_date,'out',amount,payment_method from public.restaurant_order_refunds;
grant select on public.restaurant_cashbook_entries to authenticated;

-- Existing trigger name is preserved by CREATE OR REPLACE FUNCTION in migration.
create or replace function public.calculate_cashbook_closing()
returns trigger language plpgsql as $$ begin return new; end $$;
create trigger restaurant_cashbook_closing_calculate
before insert on public.restaurant_cashbook_closings
for each row execute function public.calculate_cashbook_closing();
