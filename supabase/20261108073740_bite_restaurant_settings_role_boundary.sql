-- Platform Admin controls onboarding/publication/commission; restaurant operations belong to the Owner.
CREATE OR REPLACE FUNCTION public.guard_restaurant_platform_admin_operational_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF public.is_platform_admin() THEN
    IF NEW.city IS DISTINCT FROM OLD.city
       OR NEW.latitude IS DISTINCT FROM OLD.latitude
       OR NEW.longitude IS DISTINCT FROM OLD.longitude
       OR NEW.public_description IS DISTINCT FROM OLD.public_description
       OR NEW.cuisine_tags IS DISTINCT FROM OLD.cuisine_tags
       OR NEW.default_delivery_fee IS DISTINCT FROM OLD.default_delivery_fee
       OR NEW.minimum_order_amount IS DISTINCT FROM OLD.minimum_order_amount
       OR NEW.estimated_prep_minutes IS DISTINCT FROM OLD.estimated_prep_minutes
       OR NEW.opening_time IS DISTINCT FROM OLD.opening_time
       OR NEW.closing_time IS DISTINCT FROM OLD.closing_time
       OR NEW.is_temporarily_closed IS DISTINCT FROM OLD.is_temporarily_closed
       OR NEW.temporary_closure_until IS DISTINCT FROM OLD.temporary_closure_until
       OR NEW.delivery_paused IS DISTINCT FROM OLD.delivery_paused
       OR NEW.accepts_delivery IS DISTINCT FROM OLD.accepts_delivery
       OR NEW.accepts_pickup IS DISTINCT FROM OLD.accepts_pickup THEN
      RAISE EXCEPTION 'Only the Restaurant Owner can change operating settings.'
        USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurants_guard_platform_admin_operational_fields ON public.restaurants;
CREATE TRIGGER restaurants_guard_platform_admin_operational_fields
BEFORE UPDATE ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_platform_admin_operational_fields();
