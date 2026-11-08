-- Bite Phase 1: explicit restaurant onboarding lifecycle and approval guard.
-- Additive migration: preserves all existing restaurant rows and legacy records.

alter table public.restaurants
  add column if not exists onboarding_status text not null default 'pending',
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists onboarding_reviewed_at timestamptz,
  add column if not exists onboarding_reviewed_by uuid references auth.users(id),
  add column if not exists onboarding_rejection_reason text;

alter table public.restaurants
  drop constraint if exists restaurants_onboarding_status_check;

alter table public.restaurants
  add constraint restaurants_onboarding_status_check
  check (onboarding_status in ('pending','approved','rejected','suspended'));

-- Preserve already-public active restaurants; all other existing rows await approval.
update public.restaurants
set onboarding_status = case
  when status = 'Active' and is_published = true then 'approved'
  else 'pending'
end,
onboarding_submitted_at = coalesce(onboarding_submitted_at, created_at)
where onboarding_status = 'pending';

create index if not exists restaurants_onboarding_status_created_idx
  on public.restaurants (onboarding_status, created_at desc);

-- Restaurant owners may edit ordinary operational fields, but cannot self-approve,
-- publish, suspend, or reject their own restaurant. Only platform admins can.
create or replace function public.guard_restaurant_approval_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    if new.onboarding_status is distinct from old.onboarding_status
       or new.onboarding_reviewed_at is distinct from old.onboarding_reviewed_at
       or new.onboarding_reviewed_by is distinct from old.onboarding_reviewed_by
       or new.onboarding_rejection_reason is distinct from old.onboarding_rejection_reason
       or new.is_published is distinct from old.is_published
       or new.status is distinct from old.status then
      raise exception 'Only Bite platform administrators can change restaurant approval or publication status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_approval_fields on public.restaurants;
create trigger restaurants_guard_approval_fields
before update on public.restaurants
for each row execute function public.guard_restaurant_approval_fields();

-- Public restaurant discovery must require an explicit approved state as well as publication.
create or replace function public.is_restaurant_public(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_published = true
      and r.status = 'Active'
      and r.onboarding_status = 'approved'
  );
$$;

revoke all on function public.guard_restaurant_approval_fields() from public, anon, authenticated;
grant execute on function public.is_restaurant_public(uuid) to anon, authenticated, service_role;
