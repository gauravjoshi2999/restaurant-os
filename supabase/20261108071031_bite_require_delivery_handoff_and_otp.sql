-- Bite: enforce delivery handoff creation and customer OTP verification at the database layer.
-- UI guards are not sufficient: authenticated clients must not be able to skip these steps
-- by calling the orders table update API directly.

CREATE OR REPLACE FUNCTION public.enforce_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Received' THEN
      RAISE EXCEPTION 'A new order must start with Received status.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'Received' THEN NEW.status IN ('Accepted','Rejected','Cancelled')
    WHEN 'Accepted' THEN NEW.status IN ('Preparing','Cancelled')
    WHEN 'Preparing' THEN NEW.status IN ('Ready','Cancelled')
    WHEN 'Ready' THEN NEW.status IN ('Handed Over','Cancelled')
    WHEN 'Handed Over' THEN NEW.status = 'Completed'
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %.', OLD.status, NEW.status;
  END IF;

  IF OLD.delivery_type = 'delivery' AND NEW.status = 'Handed Over' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.restaurant_delivery_handoffs h
      WHERE h.order_id = OLD.id
        AND h.restaurant_id = OLD.restaurant_id
        AND h.is_active
        AND h.verified_at IS NULL
        AND h.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'Create a valid delivery handoff link before handing over this delivery order.';
    END IF;
  END IF;

  IF OLD.delivery_type = 'delivery' AND NEW.status = 'Completed' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.restaurant_delivery_handoffs h
      WHERE h.order_id = OLD.id
        AND h.restaurant_id = OLD.restaurant_id
        AND h.verified_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Delivery can be completed only after customer OTP verification.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
