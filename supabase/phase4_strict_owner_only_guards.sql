-- RestaurantOS Phase 4 follow-up: enforce the product's strict Owner-only rule.
-- Platform Super Admin support access does not grant operational order-control rights.
-- The only non-browser bypass is a future trusted server-side service_role connector.

create or replace function public.enforce_external_channel_manual_entry_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := coalesce((select auth.jwt())->>'role', '');
begin
  if lower(btrim(coalesce(new.channel, ''))) in ('zomato', 'swiggy', 'zomato (demo)', 'swiggy (demo)')
     and jwt_role <> 'service_role'
     and not public.has_restaurant_role(new.restaurant_id, array['owner']) then
    raise exception 'Only the restaurant Owner can manually enter Zomato/Swiggy orders.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_owner_order_status_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := coalesce((select auth.jwt())->>'role', '');
begin
  if new.status is distinct from old.status
     and jwt_role <> 'service_role'
     and not public.has_restaurant_role(new.restaurant_id, array['owner']) then
    raise exception 'Only the restaurant Owner can update order status.';
  end if;
  return new;
end;
$$;
