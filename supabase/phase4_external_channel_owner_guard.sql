-- RestaurantOS Phase 4: protect manual external-platform order entry.
-- Run only after the documented Phase 1-3 foundation and customer/order migrations.
-- This is a forward-only migration; do not rerun the original schema chain.

create or replace function public.enforce_external_channel_manual_entry_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(btrim(coalesce(new.channel, ''))) in (
    'zomato', 'swiggy', 'zomato (demo)', 'swiggy (demo)'
  ) then
    -- A future approved server-side platform connector may ingest these orders
    -- using its server-only service role. Browser users must be restaurant owners.
    if coalesce(auth.role(), '') <> 'service_role'
       and not (
         public.is_platform_admin()
         or public.has_restaurant_role(new.restaurant_id, array['owner'])
       ) then
      raise exception 'Only the restaurant Owner can manually enter Zomato/Swiggy orders.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_external_channel_manual_entry_permission()
  from public, anon, authenticated;

drop trigger if exists enforce_external_channel_manual_entry_permission_trigger
  on public.orders;

create trigger enforce_external_channel_manual_entry_permission_trigger
before insert or update of channel, restaurant_id
on public.orders
for each row
execute function public.enforce_external_channel_manual_entry_permission();

-- Order status is an Owner-controlled action in the selected workflow.
create or replace function public.enforce_owner_order_status_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_admin()
       or public.has_restaurant_role(new.restaurant_id, array['owner'])
     ) then
    raise exception 'Only the restaurant Owner can update order status.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_owner_order_status_updates()
  from public, anon, authenticated;

drop trigger if exists enforce_owner_order_status_updates_trigger
  on public.orders;

create trigger enforce_owner_order_status_updates_trigger
before update of status
on public.orders
for each row
execute function public.enforce_owner_order_status_updates();
