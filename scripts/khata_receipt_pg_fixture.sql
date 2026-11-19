\set ON_ERROR_STOP on
-- Synthetic only. This is NOT a copy of users or production data.
create schema auth;
create schema private;
create role authenticated nologin;
create role anon nologin;
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to authenticated;
grant execute on function auth.uid() to authenticated;
create or replace function public.has_restaurant_role(rid uuid,roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid
  and rid='22222222-2222-4222-8222-222222222222'::uuid and 'owner'=any(roles)
$$;
create or replace function private.bite_restaurant_staff_can(rid uuid,permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_restaurant_role(rid,array['owner']) and permission='payment_entry'
$$;
create table public.restaurant_customers(
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
 full_name text not null,status text not null default 'Active',
 created_by uuid,created_at timestamptz not null default now()
);
create table public.restaurant_customer_ledger_entries(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,
 customer_id uuid not null,entry_date date not null,entry_type text not null,
 amount numeric(14,2) not null,payment_method text,reference text,
 description text,created_by uuid not null,created_at timestamptz not null default now()
);
create table public.restaurant_cashbook_closings(restaurant_id uuid,close_date date);
create table public.bite_property_outlets(property_id uuid,restaurant_id uuid);
create table public.bite_property_shift_closings(property_id uuid,shift_date date,locked boolean);
alter table public.restaurant_customers enable row level security;
alter table public.restaurant_customer_ledger_entries enable row level security;
create policy customers_read on public.restaurant_customers for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']));
create policy ledger_read on public.restaurant_customer_ledger_entries for select to authenticated
 using(public.has_restaurant_role(restaurant_id,array['owner']));
create policy ledger_insert on public.restaurant_customer_ledger_entries for insert to authenticated
 with check(public.has_restaurant_role(restaurant_id,array['owner']) and created_by=auth.uid());
grant select on public.restaurant_customers,public.restaurant_customer_ledger_entries to authenticated;
grant insert on public.restaurant_customer_ledger_entries to authenticated;
grant execute on function private.bite_restaurant_staff_can(uuid,text) to authenticated;
create view public.restaurant_customer_balances with (security_invoker=true) as
 select c.id customer_id,c.restaurant_id,c.full_name,c.status,
  coalesce(sum(case when l.entry_type='debit' then l.amount else -l.amount end),0)::numeric(14,2) balance
 from public.restaurant_customers c left join public.restaurant_customer_ledger_entries l
  on l.customer_id=c.id and l.restaurant_id=c.restaurant_id
 group by c.id,c.restaurant_id,c.full_name,c.status;
grant select on public.restaurant_customer_balances to authenticated;
create view public.restaurant_cashbook_entries with (security_invoker=true) as
 select l.id entry_id,l.restaurant_id,l.entry_date,'in'::text direction,l.amount,
  l.payment_method,'customer_ledger_payment'::text source_type
 from public.restaurant_customer_ledger_entries l where l.entry_type='credit';
grant select on public.restaurant_cashbook_entries to authenticated;
insert into public.restaurant_customers(id,restaurant_id,full_name,created_by) values
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Customer A','11111111-1111-4111-8111-111111111111'),
 ('55555555-5555-4555-8555-555555555555','99999999-9999-4999-8999-999999999999','Other tenant','11111111-1111-4111-8111-111111111111');
insert into public.restaurant_customer_ledger_entries(
 restaurant_id,customer_id,entry_date,entry_type,amount,description,created_by)
values('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 (now() at time zone 'Asia/Kolkata')::date-10,'debit',100,'Historical opening due',
 '11111111-1111-4111-8111-111111111111');
