-- Ensure every public restaurant discovery and checkout path enforces Admin approval.
create or replace function public.list_public_restaurants()
returns table(
 id uuid, name text, city text, address text, public_description text,
 cuisine_tags text[], default_delivery_fee numeric, minimum_order_amount numeric,
 accepts_delivery boolean, accepts_pickup boolean, estimated_prep_minutes integer,
 latitude double precision, longitude double precision, average_rating numeric, review_count bigint
)
language sql stable security definer set search_path = ''
as $$
 select r.id,r.name,r.city,r.address,r.public_description,r.cuisine_tags,
  r.default_delivery_fee,r.minimum_order_amount,r.accepts_delivery,r.accepts_pickup,
  r.estimated_prep_minutes,r.latitude,r.longitude,
  coalesce(avg(rv.rating),0)::numeric(2,1),count(rv.id)
 from public.restaurants r
 left join public.restaurant_reviews rv on rv.restaurant_id=r.id and rv.status='Published'
 where r.is_published and r.status='Active' and r.onboarding_status='approved'
 group by r.id order by r.name;
$$;

do $$
declare v_definition text;
 v_old text := 'where r.id = p_restaurant_id and r.is_published and r.status = ''Active'';';
 v_new text := 'where r.id = p_restaurant_id and r.is_published and r.status = ''Active'' and r.onboarding_status = ''approved'';';
begin
 select pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure) into v_definition;
 if position(v_new in v_definition)>0 then return; end if;
 if position(v_old in v_definition)=0 then
  raise exception 'Could not safely locate checkout restaurant eligibility clause; no checkout function changes applied.';
 end if;
 execute replace(v_definition,v_old,v_new);
end;
$$;

revoke all on function public.list_public_restaurants() from public;
grant execute on function public.list_public_restaurants() to anon, authenticated, service_role;
