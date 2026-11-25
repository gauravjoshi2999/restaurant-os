-- Isolated PostgreSQL QA only; never execute this fixture on production.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated;
create table public.restaurant_members(restaurant_id uuid,user_id uuid,role text);
create function public.is_platform_admin() returns boolean language sql stable as $$
 select auth.uid()='00000000-0000-0000-0000-000000000003'::uuid
$$;
create function public.has_restaurant_role(rid uuid,allowed text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select not public.is_platform_admin() and exists(select 1 from public.restaurant_members m
 where m.restaurant_id=rid and m.user_id=auth.uid() and m.role=any(allowed))
$$;
create function public.is_restaurant_member(rid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.restaurant_members m where m.restaurant_id=rid and m.user_id=auth.uid())
$$;
create function public.is_restaurant_public(rid uuid) returns boolean language sql stable as $$select true$$;
create function public.bite_outlet_module_enabled(rid uuid,module_name text) returns boolean language sql stable as $$select true$$;
create table public.menu_items(id uuid primary key,restaurant_id uuid not null,name text not null,
 price numeric not null,is_vegetarian boolean not null default false,is_available boolean not null default true);
alter table public.menu_items enable row level security;
-- Exact current production menu policy predicates; membership/module helpers
-- above are deterministic fixture substitutes, not production role acceptance.
create policy "bite_menu_module_read" on public.menu_items for select to anon,authenticated
 using(bite_outlet_module_enabled(restaurant_id,'restaurant_menu'::text));
create policy "public can read available items from published menus" on public.menu_items for select to anon,authenticated
 using(is_available=true and is_restaurant_public(restaurant_id));
create policy "restaurant teams can read all menu items" on public.menu_items for select to authenticated
 using(is_platform_admin() or is_restaurant_member(restaurant_id));
create policy "restaurant teams manage menu items" on public.menu_items for all to authenticated
 using(false or has_restaurant_role(restaurant_id,array['owner'::text,'manager'::text]))
 with check(false or has_restaurant_role(restaurant_id,array['owner'::text,'manager'::text]));
-- Deliberately broad fixture table privileges: RLS must still deny other actors.
grant select,insert,update,delete on public.menu_items to anon,authenticated;
insert into public.restaurant_members values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','staff'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','manager');
insert into public.menu_items values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Legacy Veg',120,true,true),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Legacy Other',200,false,true);
