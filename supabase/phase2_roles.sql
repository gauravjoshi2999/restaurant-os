-- RestaurantOS Phase 2: platform Super Admin + tenant role authorization
-- Prerequisite: run supabase/schema.sql first.
-- Safe to re-run: policies are dropped before being recreated.
-- First Super Admin is bootstrapped separately by inserting their Auth user UUID
-- into public.platform_admins from the Supabase SQL Editor.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

-- Only authenticated sessions may evaluate this helper. The function returns
-- only whether the current user is a platform admin.
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Platform admins can inspect platform-wide user profiles, but cannot edit
-- another user's profile through this policy.
drop policy if exists "platform admins can read all profiles" on public.profiles;
create policy "platform admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_platform_admin());

-- Restaurant owners/managers retain their existing tenant-scoped policies.
-- Platform admins can view and update restaurant onboarding/status details.
drop policy if exists "platform admins can read all restaurants" on public.restaurants;
create policy "platform admins can read all restaurants"
on public.restaurants
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform admins can update all restaurants" on public.restaurants;
create policy "platform admins can update all restaurants"
on public.restaurants
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Platform admins can view and manage memberships across tenants.
drop policy if exists "platform admins can read all memberships" on public.restaurant_members;
create policy "platform admins can read all memberships"
on public.restaurant_members
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform admins can manage all memberships" on public.restaurant_members;
create policy "platform admins can manage all memberships"
on public.restaurant_members
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Platform admins can inspect and manage orders across tenants.
drop policy if exists "platform admins can manage all orders" on public.orders;
create policy "platform admins can manage all orders"
on public.orders
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- No ordinary user can add themselves to this table. The first admin is
-- inserted manually in the SQL Editor; subsequent changes require an admin.
drop policy if exists "platform admins can manage platform admins" on public.platform_admins;
create policy "platform admins can manage platform admins"
on public.platform_admins
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

grant select, insert, update, delete on public.platform_admins to authenticated;

-- Effective role matrix after this migration:
-- Super Admin: platform-wide read; update restaurants; manage memberships,
--              orders, and platform-admin assignments.
-- Owner:       full access inside their own restaurant; manage its team.
-- Manager:     read/update restaurant and orders inside their own restaurant;
--              cannot delete restaurant/orders or manage team membership.
-- Staff:       read restaurant/orders and create orders inside their own
--              restaurant; cannot update/delete orders or manage team.
--
-- Existing base policies already implement the tenant-scoped Owner/Manager/
-- Staff rules. This migration adds the Super Admin exception without removing
-- tenant isolation for ordinary users.
