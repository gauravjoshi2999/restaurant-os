-- RestaurantOS Phase 3A: onboarding fields + restaurant creation hardening
-- Run once in Supabase SQL Editor. Safe to re-run.

-- Only a verified platform Super Admin may create a restaurant record.
-- The earlier broad policy allowed any authenticated account to create one.
drop policy if exists "authenticated users can create restaurants" on public.restaurants;
drop policy if exists "platform admins can create restaurants" on public.restaurants;
create policy "platform admins can create restaurants"
on public.restaurants
for insert
to authenticated
with check (
  public.is_platform_admin()
  and created_by = (select auth.uid())
);

-- Additional information collected during restaurant onboarding.
alter table public.restaurants
  add column if not exists contact_person text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

-- Keep old rows valid; standardize only blank/null status values.
update public.restaurants
set status = 'Lead added'
where status is null or btrim(status) = '';

-- Allow platform admins to update onboarding details across all restaurants.
-- This policy is idempotent and complements the Phase 2 policy set.
drop policy if exists "platform admins can update all restaurants" on public.restaurants;
create policy "platform admins can update all restaurants"
on public.restaurants
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Verify expected columns and policy after running.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'restaurants'
  and column_name in ('contact_person','email','address','notes','updated_at')
order by column_name;

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'restaurants'
order by policyname;
