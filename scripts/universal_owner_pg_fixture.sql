-- SYNTHETIC fixture for an EMPTY disposable PostgreSQL database only.
create schema auth;
create role authenticated nologin;
create role anon nologin;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.platform_admins(user_id uuid primary key);
create table public.restaurants(id uuid primary key,name text,address text,phone text);
create table public.restaurant_members(restaurant_id uuid,user_id uuid,role text,primary key(restaurant_id,user_id));
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.platform_admins where user_id=auth.uid())$$;
create function public.has_restaurant_role(target_restaurant uuid,allowed_roles text[]) returns boolean language sql stable security definer set search_path='' as $$select not public.is_platform_admin() and exists(select 1 from public.restaurant_members where restaurant_id=target_restaurant and user_id=auth.uid() and role=any(allowed_roles))$$;
create table public.orders(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants,order_code text,channel text,amount numeric(14,2),status text default 'Completed',waived_off_amount numeric(14,2) default 0,is_demo boolean default false,restaurant_customer_id uuid,unique(restaurant_id,order_code));
create table public.restaurant_order_payments(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders,amount numeric(14,2));
create table public.restaurant_order_refunds(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders);
create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders,item_name text,quantity numeric,unit_price numeric);
create table public.menu_categories(id uuid primary key,restaurant_id uuid);
create table public.menu_items(id uuid primary key,restaurant_id uuid);
alter table public.menu_items enable row level security;
alter table public.menu_categories enable row level security;
create view public.restaurant_order_payment_summaries as select id as order_id,restaurant_id,amount as balance_amount from public.orders;
create table public.bite_refund_jobs(order_id uuid,status text);
create table public.bite_live_checkout_intents(restaurant_id uuid,status text);
-- Minimal synthetic stand-in for the pre-existing POS engine. Production keeps
-- its real pricing/item/payment/RLS logic, whose source regressions run separately.
create function public.create_pos_order_with_payment(p_restaurant_id uuid,p_order_code text,p_channel text,p_customer_name text,p_customer_phone text,p_items jsonb,p_paid_amount numeric,p_payment_method text,p_payment_date date,p_reference text,p_table_id uuid) returns uuid language plpgsql as $$
declare id uuid; total numeric; begin
 select sum((i->>'quantity')::numeric*(i->>'unit_price')::numeric) into total from jsonb_array_elements(p_items) i;
 insert into public.orders(restaurant_id,order_code,channel,amount) values(p_restaurant_id,p_order_code,p_channel,total) returning orders.id into id;return id;
end $$;
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111'), -- owner A
 ('22222222-2222-4222-8222-222222222222'), -- owner B
 ('33333333-3333-4333-8333-333333333333'), -- receptionist
 ('44444444-4444-4444-8444-444444444444'), -- housekeeping
 ('55555555-5555-4555-8555-555555555555'), -- accountant
 ('66666666-6666-4666-8666-666666666666'), -- admin
 ('77777777-7777-4777-8777-777777777777'); -- cashier
insert into public.platform_admins values('66666666-6666-4666-8666-666666666666');
insert into public.restaurants values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic Restaurant A','',''),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic Restaurant B','','');
insert into public.restaurant_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner');
