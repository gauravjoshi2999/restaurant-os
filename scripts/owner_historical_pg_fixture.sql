\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
end$$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.restaurants(id uuid primary key);
create table public.bite_properties(id uuid primary key,origin_restaurant_id uuid references public.restaurants(id));
create table public.restaurant_members(restaurant_id uuid not null references public.restaurants(id),user_id uuid not null,role text not null);
create table public.bite_property_members(property_id uuid not null references public.bite_properties(id),user_id uuid not null,role text not null,active boolean not null);
grant select on public.restaurants, public.bite_properties, public.restaurant_members,public.bite_property_members to authenticated;
alter table public.restaurant_members enable row level security;
alter table public.bite_property_members enable row level security;
alter table public.bite_properties enable row level security;
alter table public.restaurants enable row level security;
create policy rm_self on public.restaurant_members for select to authenticated using(user_id=auth.uid());
create policy pm_self on public.bite_property_members for select to authenticated using(user_id=auth.uid());
create policy prop_self on public.bite_properties for select to authenticated using(exists(select 1 from public.bite_property_members m where m.property_id=id and m.user_id=auth.uid()));
create policy rest_self on public.restaurants for select to authenticated using(exists(select 1 from public.restaurant_members m where m.restaurant_id=id and m.user_id=auth.uid()));
insert into public.restaurants(id)values('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.bite_properties(id,origin_restaurant_id)values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.restaurant_members(restaurant_id,user_id,role)values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','owner'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','owner');
insert into public.bite_property_members(property_id,user_id,role,active)values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner',true);
