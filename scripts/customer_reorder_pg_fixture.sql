-- Synthetic Reorder-only PostgreSQL fixture: no personal, payment or production data.
create schema if not exists auth;
create role anon nologin;
create role authenticated nologin;
create or replace function auth.uid() returns uuid language sql stable set search_path='' as
$$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.orders(
 id uuid primary key,
 customer_id uuid not null,
 restaurant_id uuid not null
);
create table public.order_items(
 id uuid primary key,
 order_id uuid not null references public.orders(id),
 menu_item_id uuid,
 item_name text not null,
 quantity numeric not null,
 unit_price numeric not null,
 created_at timestamptz not null
);
create table public.menu_items(
 id uuid primary key,
 restaurant_id uuid not null,
 name text not null,
 price numeric not null,
 is_available boolean not null
);
create table public.restaurant_qa_availability(
 id uuid primary key,
 active boolean not null
);
create or replace function public.is_restaurant_public(p_restaurant uuid)
returns boolean language sql stable security definer set search_path='' as
$$select coalesce((select active from public.restaurant_qa_availability where id=p_restaurant),false)$$;
insert into public.restaurant_qa_availability values
('11111111-1111-4111-8111-111111111111',true),
('99999999-9999-4999-8999-999999999999',true);
insert into public.orders values
('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111');
insert into public.menu_items values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Masala Dosa',135,true),
('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','Paneer Tikka',250,false),
('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','Special Poha',60,true),
('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','Duplicate Menu',40,true),
('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','Duplicate Menu',42,true),
('99999999-9999-4999-8999-999999999998','99999999-9999-4999-8999-999999999999','Outside Seller Dish',70,true);
insert into public.order_items values
('00000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','Masala Dosa',2,120,'2026-11-01T10:01:00Z'),
('00000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','Paneer Tikka',1,220,'2026-11-01T10:02:00Z'),
('00000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222',null,'Special Poha',1,55,'2026-11-01T10:03:00Z'),
('00000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222',null,'Duplicate Menu',1,40,'2026-11-01T10:04:00Z'),
('00000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999998','Outside Seller Dish',1,65,'2026-11-01T10:05:00Z'),
('00000000-0000-4000-8000-000000000006','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','Masala Dosa',1,120,'2026-11-01T10:06:00Z');
