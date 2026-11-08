-- Public delivery-area checks must obey the same Admin approval gate as discovery and checkout.
create or replace function public.check_restaurant_delivery_area(p_restaurant_id uuid,p_postal_code text)
returns table(serviceable boolean,zone_name text,delivery_fee numeric,minimum_order_amount numeric)
language sql stable security definer set search_path=''
as $function$
 select (z.id is not null),z.name,
  coalesce(z.delivery_fee,r.default_delivery_fee,0),
  greatest(coalesce(r.minimum_order_amount,0),coalesce(z.minimum_order_amount,0))
 from public.restaurants r
 left join public.restaurant_delivery_zone_pincodes zp
  on zp.restaurant_id=r.id and zp.postal_code=regexp_replace(coalesce(p_postal_code,''),'[^0-9]','','g')
 left join public.restaurant_delivery_zones z
  on z.id=zp.zone_id and z.restaurant_id=r.id and z.is_active
 where r.id=p_restaurant_id and r.is_published and r.status='Active'
  and r.onboarding_status='approved';
$function$;
revoke all on function public.check_restaurant_delivery_area(uuid,text) from public;
grant execute on function public.check_restaurant_delivery_area(uuid,text) to anon,authenticated,service_role;