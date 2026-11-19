-- Isolated Postgres 17 A10 fixture. All identities and money are synthetic.
create extension if not exists pgcrypto;
create schema if not exists auth;
do $$begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end$$;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key);
create table public.restaurants(id uuid primary key);
create table public.restaurant_employees(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 joining_date date not null,full_name text not null, salary_amount numeric(14,2) not null default 0,
 salary_period text not null default 'Monthly', status text not null default 'Active'
);
create table public.restaurant_employee_payments(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id),
 employee_id uuid not null references public.restaurant_employees(id),
 payment_date date not null,
 period_month date, payment_type text not null, amount numeric(14,2) not null
);
create table public.fixture_memberships(user_id uuid,restaurant_id uuid,role text,
 primary key(user_id,restaurant_id,role));
create function public.has_restaurant_role(p_restaurant_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fixture_memberships
  where user_id=auth.uid() and restaurant_id=p_restaurant_id and role=any(p_roles))
$$;
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.has_restaurant_role(uuid,text[]) to authenticated;
grant select on public.restaurant_employees,public.restaurant_employee_payments to authenticated;
insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.restaurants(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
insert into public.fixture_memberships values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','manager'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','owner');
insert into public.restaurant_employees(id,restaurant_id,joining_date,full_name) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','2026-09-01','Synthetic staff A'),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','2026-09-01','Synthetic staff B'),
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','2026-09-01','Synthetic staff C');
insert into public.restaurant_employee_payments(restaurant_id,employee_id,payment_date,period_month,payment_type,amount) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2026-09-02','2026-09-01','Advance',500),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2026-10-20','2026-10-01','Advance',400),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2026-11-02','2026-10-01','Salary',3000),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2026-10-28','2026-10-01','Bonus',250);
