-- RestaurantOS Supabase foundation
-- Run this entire file in Supabase Dashboard > SQL Editor > New query.
-- This creates tenant-isolated tables. Never put the service_role key in the browser.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  city text not null default 'Rajsamand',
  status text not null default 'Lead added',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_code text not null,
  channel text not null default 'Own Platform',
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'Received',
  platform_reported numeric(12,2),
  bank_payout numeric(12,2),
  order_date timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (restaurant_id, order_code)
);

create index if not exists orders_restaurant_date_idx
  on public.orders (restaurant_id, order_date desc);
create index if not exists restaurant_members_user_idx
  on public.restaurant_members (user_id);

-- Helper functions avoid recursive membership-policy evaluation.
create or replace function public.is_restaurant_member(target_restaurant uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = target_restaurant
      and rm.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_restaurant_role(target_restaurant uuid, allowed_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = target_restaurant
      and rm.user_id = (select auth.uid())
      and rm.role = any(allowed_roles)
  );
$$;


-- Restrict SECURITY DEFINER helpers to authenticated policy evaluation.
-- Trigger functions are not callable through the client API.
revoke execute on function public.is_restaurant_member(uuid) from public, anon;
revoke execute on function public.has_restaurant_role(uuid, text[]) from public, anon;
grant execute on function public.is_restaurant_member(uuid) to authenticated;
grant execute on function public.has_restaurant_role(uuid, text[]) to authenticated;
revoke execute on function public.add_creator_as_restaurant_owner() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.orders enable row level security;

drop policy if exists "profile read own" on public.profiles;
create policy "profile read own" on public.profiles
for select to authenticated using (id = auth.uid());
drop policy if exists "profile insert own" on public.profiles;
create policy "profile insert own" on public.profiles
for insert to authenticated with check (id = auth.uid());
drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "restaurant members can read restaurant" on public.restaurants;
create policy "restaurant members can read restaurant" on public.restaurants
for select to authenticated using (public.is_restaurant_member(id));
drop policy if exists "authenticated users can create restaurants" on public.restaurants;
create policy "authenticated users can create restaurants" on public.restaurants
for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "owners and managers can update restaurant" on public.restaurants;
create policy "owners and managers can update restaurant" on public.restaurants
for update to authenticated using (public.has_restaurant_role(id, array['owner','manager']))
with check (public.has_restaurant_role(id, array['owner','manager']));
drop policy if exists "owners can delete restaurant" on public.restaurants;
create policy "owners can delete restaurant" on public.restaurants
for delete to authenticated using (public.has_restaurant_role(id, array['owner']));

drop policy if exists "members can read memberships" on public.restaurant_members;
create policy "members can read memberships" on public.restaurant_members
for select to authenticated using (public.is_restaurant_member(restaurant_id));
drop policy if exists "owners can manage memberships" on public.restaurant_members;
create policy "owners can manage memberships" on public.restaurant_members
for all to authenticated
using (public.has_restaurant_role(restaurant_id, array['owner']))
with check (public.has_restaurant_role(restaurant_id, array['owner']));

drop policy if exists "members can read orders" on public.orders;
create policy "members can read orders" on public.orders
for select to authenticated using (public.is_restaurant_member(restaurant_id));
drop policy if exists "members can create orders" on public.orders;
create policy "members can create orders" on public.orders
for insert to authenticated with check (
  created_by = auth.uid()
  and public.is_restaurant_member(restaurant_id)
);
drop policy if exists "owners managers can update orders" on public.orders;
create policy "owners managers can update orders" on public.orders
for update to authenticated using (
  public.has_restaurant_role(restaurant_id, array['owner','manager'])
) with check (
  public.has_restaurant_role(restaurant_id, array['owner','manager'])
);
drop policy if exists "owners can delete orders" on public.orders;
create policy "owners can delete orders" on public.orders
for delete to authenticated using (
  public.has_restaurant_role(restaurant_id, array['owner'])
);

-- New restaurant creator is automatically its owner.
create or replace function public.add_creator_as_restaurant_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists restaurant_creator_membership on public.restaurants;
create trigger restaurant_creator_membership
after insert on public.restaurants
for each row execute function public.add_creator_as_restaurant_owner();

-- Automatically create a profile for each newly registered auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.restaurants,
  public.restaurant_members, public.orders to authenticated;
