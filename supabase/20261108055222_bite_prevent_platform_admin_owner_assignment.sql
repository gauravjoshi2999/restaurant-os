create or replace function public.enforce_single_restaurant_owner_assignment()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.role <> 'owner' then
    return new;
  end if;

  if exists (
    select 1 from public.platform_admins pa where pa.user_id = new.user_id
  ) then
    raise exception 'A Platform Admin account cannot also be assigned as a Restaurant Owner.';
  end if;

  if tg_op = 'UPDATE'
     and new.restaurant_id = old.restaurant_id
     and new.user_id = old.user_id
     and new.role = old.role then
    return new;
  end if;

  if exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = new.restaurant_id
      and rm.role = 'owner'
      and rm.user_id <> new.user_id
  ) then
    raise exception 'This restaurant already has an Owner account. Resolve the existing Owner mapping before assigning another.';
  end if;

  return new;
end;
$$;
