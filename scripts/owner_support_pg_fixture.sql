-- Isolated QA only. Never execute on a production project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.restaurants(id uuid primary key);
create table public.restaurant_members(restaurant_id uuid,user_id uuid,role text);
create table public.platform_admins(user_id uuid);
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins where user_id=(select auth.uid()))
$$;
create function public.has_restaurant_role(target_restaurant uuid, allowed_roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select not public.is_platform_admin() and exists(select 1 from public.restaurant_members rm where rm.restaurant_id=target_restaurant and rm.user_id=(select auth.uid()) and rm.role=any(allowed_roles))
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into public.restaurants values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.restaurant_members values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','staff');
insert into public.platform_admins values ('00000000-0000-0000-0000-000000000003');
