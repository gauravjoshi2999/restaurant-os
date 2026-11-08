-- Owner availability controls for the BITE marketplace.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS is_temporarily_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_closure_until timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_time time,
  ADD COLUMN IF NOT EXISTS closing_time time;

CREATE OR REPLACE FUNCTION public.guard_marketplace_order_availability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_closed boolean;
  v_closed_until timestamptz;
  v_delivery_paused boolean;
BEGIN
  IF NEW.channel <> 'Own Platform' THEN RETURN NEW; END IF;
  SELECT r.is_temporarily_closed, r.temporary_closure_until, r.delivery_paused
    INTO v_closed, v_closed_until, v_delivery_paused
  FROM public.restaurants r WHERE r.id = NEW.restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant is not available for marketplace orders.'; END IF;
  IF coalesce(v_closed,false) AND (v_closed_until IS NULL OR v_closed_until > now()) THEN
    RAISE EXCEPTION 'This restaurant is temporarily closed and is not accepting new orders.';
  END IF;
  IF NEW.delivery_type = 'delivery' AND coalesce(v_delivery_paused,false) THEN
    RAISE EXCEPTION 'This restaurant has temporarily paused delivery. Choose pickup if available.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_marketplace_order_availability ON public.orders;
CREATE TRIGGER trg_guard_marketplace_order_availability
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_order_availability();

DROP FUNCTION IF EXISTS public.list_public_restaurants();
CREATE FUNCTION public.list_public_restaurants()
RETURNS TABLE(
  id uuid, name text, city text, address text, public_description text,
  cuisine_tags text[], default_delivery_fee numeric, minimum_order_amount numeric,
  accepts_delivery boolean, accepts_pickup boolean, estimated_prep_minutes integer,
  latitude double precision, longitude double precision, average_rating numeric,
  review_count bigint, is_temporarily_closed boolean, temporary_closure_until timestamptz,
  delivery_paused boolean, opening_time time, closing_time time
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT r.id,r.name,r.city,r.address,r.public_description,r.cuisine_tags,
    r.default_delivery_fee,r.minimum_order_amount,r.accepts_delivery,r.accepts_pickup,
    r.estimated_prep_minutes,r.latitude,r.longitude,
    coalesce(avg(rv.rating),0)::numeric(2,1),count(rv.id),
    coalesce(r.is_temporarily_closed,false),r.temporary_closure_until,
    coalesce(r.delivery_paused,false),r.opening_time,r.closing_time
  FROM public.restaurants r
  LEFT JOIN public.restaurant_reviews rv ON rv.restaurant_id=r.id AND rv.status='Published'
  WHERE r.is_published AND r.status='Active' AND r.onboarding_status='approved'
  GROUP BY r.id ORDER BY r.name;
$function$;
GRANT EXECUTE ON FUNCTION public.list_public_restaurants() TO anon, authenticated, service_role;
