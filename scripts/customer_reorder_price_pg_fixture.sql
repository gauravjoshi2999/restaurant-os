-- Bite Customer ORD-08: isolated SQL fixture, never production data.
create extension if not exists pgcrypto;
create schema if not exists auth;
do $$begin
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
end$$;
create function auth.uid() returns uuid language sql stable
 as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.orders (
 id uuid primary key,restaurant_id uuid not null,customer_id uuid,
 created_at timestamptz not null default now()
);
create table public.order_items (
 id uuid primary key,order_id uuid not null references public.orders(id),
 item_name text not null, quantity numeric not null,
 unit_price numeric not null,menu_item_id uuid,created_at timestamptz not null default now()
);
create table public.menu_items(
 id uuid primary key,restaurant_id uuid not null,name text not null,
 price numeric not null,is_available boolean not null
);
create function public.is_restaurant_public(r uuid)
returns boolean stable language sql as $$select r='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid$$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid(),public.is_restaurant_public(uuid) to authenticated,anon;
insert into public.orders(id,restaurant_id,customer_id) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-1111-4111-8111-111111111111');
insert into public.menu_items(id,restaurant_id,name,price,is_available) values
 ('aaaaaaaa-0001-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Masala Dosa',130,true),
 ('aaaaaaaa-0002-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Paneer Tikka',220,false),
 ('bbbbbbbb-0003-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other tenant dish',12,true);
insert into public.order_items(id,order_id,item_name,quantity,unit_price,menu_item_id,created_at) values
 ('00000000-0001-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Masala Dosa',2,120,'aaaaaaaa-0001-4000-8000-000000000001','2026-11-01T12:00:00Z'),
 ('00000000-0002-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Paneer Tikka',1,220,'aaaaaaaa-0002-4000-8000-000000000002','2026-11-01T12:01:00Z'),
 ('00000000-0003-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Unknown soup',1,45,null,'2026-11-01T12:02:00Z'),
 ('00000000-0004-4000-8000-000000000004','22222222-2222-4222-8222-222222222222','Other order',1,950,null,'2026-11-01T12:02:00Z');
