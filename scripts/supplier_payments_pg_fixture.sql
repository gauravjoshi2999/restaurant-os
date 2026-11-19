\set ON_ERROR_STOP on
-- Ephemeral PostgreSQL 17 only. Mimics actual supplier/cashbook columns & owner auth.
create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create role authenticated nologin;
create role anon nologin;
grant usage on schema auth,public to authenticated;
grant execute on function auth.uid() to authenticated;
create or replace function public.has_restaurant_role(rid uuid,roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid
   and rid='22222222-2222-4222-8222-222222222222'::uuid
   and 'owner'=any(roles)
$$;
grant execute on function public.has_restaurant_role(uuid,text[]) to authenticated;
create table public.restaurant_purchases(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null,
 supplier_id uuid,
 supplier_name_snapshot text,
 purchase_date date not null,
 total_amount numeric(14,2) not null,
 paid_amount numeric(14,2) not null default 0,
 payment_method text not null default 'Unpaid',
 notes text
);
create table public.restaurant_suppliers(id uuid primary key,restaurant_id uuid,name text);
create table public.restaurant_expenses(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null,expense_date date not null,
 category text not null,amount numeric(14,2) not null,
 payment_method text not null,title text not null,created_at timestamptz default now()
);
create table public.restaurant_cashbook_closings(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 close_date date not null
);
create table public.bite_property_outlets(property_id uuid,restaurant_id uuid);
create table public.bite_property_shift_closings(property_id uuid,shift_date date,locked boolean);
alter table public.restaurant_purchases enable row level security;
create policy purchase_read on public.restaurant_purchases for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']));
create policy purchase_write on public.restaurant_purchases for update to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']))
 with check(public.has_restaurant_role(restaurant_id,array['owner']));
alter table public.restaurant_suppliers enable row level security;
create policy supplier_read on public.restaurant_suppliers for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']));
alter table public.restaurant_expenses enable row level security;
create policy expenses_read on public.restaurant_expenses for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']));
grant select,update on public.restaurant_purchases to authenticated;
grant select on public.restaurant_suppliers,public.restaurant_expenses to authenticated;
create view public.restaurant_cashbook_entries with (security_invoker=true) as
 select e.id entry_id,e.restaurant_id,e.expense_date entry_date,'out'::text direction,e.category,
  e.amount,e.payment_method,e.title description,'expense'::text source_type,
  e.id source_id,e.created_at
 from public.restaurant_expenses e
 union all
 select p.id,p.restaurant_id,p.purchase_date,'out'::text,
  'Purchase payment'::text,p.paid_amount,p.payment_method,
  coalesce(p.supplier_name_snapshot,'Purchase payment')::text,'purchase'::text,
  p.id,now() from public.restaurant_purchases p where p.paid_amount>0;
grant select on public.restaurant_cashbook_entries to authenticated;
-- Data before the migration: legacy purchase with 100 paid, and an unpaid supplier due.
insert into public.restaurant_purchases(id,restaurant_id,purchase_date,total_amount,paid_amount,payment_method,supplier_name_snapshot) values
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
 (now() at time zone 'Asia/Kolkata')::date-12,1000,100,'Cash','Old supplier'),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
 (now() at time zone 'Asia/Kolkata')::date-12,800,0,'Unpaid','Credit supplier'),
 ('55555555-5555-4555-8555-555555555555','99999999-9999-4999-8999-999999999999',
 (now() at time zone 'Asia/Kolkata')::date-12,500,0,'Unpaid','Other tenant');
insert into public.restaurant_expenses(restaurant_id,expense_date,category,amount,payment_method,title)
values('22222222-2222-4222-8222-222222222222',(now() at time zone 'Asia/Kolkata')::date-12,'Gas',50,'Cash','Cylinder');
