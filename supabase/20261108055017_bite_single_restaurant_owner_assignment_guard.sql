create or replace function public.enforce_single_restaurant_owner_assignment()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.restaurant_id = old.restaurant_id
     and new.user_id = old.user_id
     and new.role = old.role then
    return new;
  end if;

  if exists (
    select 1
    from public.restaurant_members rm
    where rm.restaurant_id = new.restaurant_id
      and rm.role = 'owner'
      and rm.user_id <> new.user_id
  ) then
    raise exception 'This restaurant already has an Owner account. Resolve the existing Owner mapping before assigning another.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_single_restaurant_owner_assignment on public.restaurant_members;
create trigger enforce_single_restaurant_owner_assignment
before insert or update of restaurant_id, user_id, role
on public.restaurant_members
for each row
execute function public.enforce_single_restaurant_owner_assignment();

revoke all on function public.enforce_single_restaurant_owner_assignment() from public, anon, authenticated;
