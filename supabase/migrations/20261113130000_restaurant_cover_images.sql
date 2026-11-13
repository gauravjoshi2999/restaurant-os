-- Restaurant hero photo ownership and public storefront read. Existing menus/orders untouched.
alter table public.restaurants add column if not exists cover_image_path text;
alter table public.restaurants add column if not exists cover_image_updated_at timestamptz;
do $$
begin
 if not exists (select 1 from pg_constraint where conrelid='public.restaurants'::regclass and conname='restaurant_cover_path_scoped') then
  alter table public.restaurants add constraint restaurant_cover_path_scoped check (
    cover_image_path is null or
    cover_image_path ~ ('^'||id::text||'/covers/[a-z0-9-]+\.webp$')
  );
 end if;
end $$;
CREATE OR REPLACE FUNCTION public.bite_storefront(p_postal_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('restaurants',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'cover_image_path',(select cr.cover_image_path from public.restaurants cr where cr.id=r.id),
 'serviceable',case when p_postal_code is null then null else exists(select 1 from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id where zp.restaurant_id=r.id and zp.postal_code=p_postal_code and z.is_active) end,
 'zone_delivery_fee',(select min(z.delivery_fee) from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id where zp.restaurant_id=r.id and zp.postal_code=p_postal_code and z.is_active),
 'price_from',(select min(m.price) from public.menu_items m where m.restaurant_id=r.id and m.is_available),
 'has_veg',exists(select 1 from public.menu_items m where m.restaurant_id=r.id and m.is_available and m.is_vegetarian),
 'has_nonveg',exists(select 1 from public.menu_items m where m.restaurant_id=r.id and m.is_available and not m.is_vegetarian),
 'featured',exists(select 1 from public.bite_featured_restaurants f where f.restaurant_id=r.id and f.starts_at<=now() and (f.ends_at is null or f.ends_at>now()))
 )) from public.list_public_restaurants() r),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.name) from public.bite_storefront_categories c where c.is_active),'[]'::jsonb));
$function$

