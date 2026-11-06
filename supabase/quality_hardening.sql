-- RestaurantOS Quality Improvement: database policy hardening
-- Prerequisites: schema.sql, phase2_roles.sql and phase3_onboarding.sql have been run.
-- Safe to re-run. This migration does not delete restaurant, order or membership data.

begin;

-- IMPORTANT: PostgreSQL permissive policies are combined with OR.
-- Remove the legacy Owner delete policy so only the Phase 3 Super Admin
-- delete policy can authorize restaurant deletion.
drop policy if exists "owners can delete restaurant" on public.restaurants;

-- A Super Admin creating an onboarding record must not automatically become
-- the restaurant's operational Owner. Owner assignment will happen through
-- the later, explicit restaurant-owner onboarding/invitation flow.
-- Preserve the existing creator-as-owner behavior for non-platform creators.
create or replace function public.add_creator_as_restaurant_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = new.created_by
  ) then
    insert into public.restaurant_members (restaurant_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function public.add_creator_as_restaurant_owner()
from public, anon, authenticated;

-- Verification 1: the legacy Owner delete policy must not appear.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'restaurants'
order by policyname;

-- Verification 2: show the effective trigger function definition.
select pg_get_functiondef('public.add_creator_as_restaurant_owner()'::regprocedure)
  as creator_membership_trigger_definition;

commit;
