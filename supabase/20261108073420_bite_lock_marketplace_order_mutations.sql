-- Marketplace orders originate from customer checkout; restaurants may progress status only.
DROP POLICY IF EXISTS "members can create orders" ON public.orders;
DROP POLICY IF EXISTS "owners can delete orders" ON public.orders;
REVOKE INSERT, DELETE ON TABLE public.orders FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_owner_order_mutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_jwt_role text := coalesce((SELECT auth.jwt())->>'role','');
  v_new_payload jsonb;
  v_old_payload jsonb;
BEGIN
  IF v_jwt_role = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_payload := to_jsonb(NEW) - ARRAY['status','status_note'];
  v_old_payload := to_jsonb(OLD) - ARRAY['status','status_note'];

  -- Customer cancellation and OTP delivery completion are narrow, RPC-controlled transitions.
  IF current_setting('app.customer_cancel',true)='true'
     AND OLD.customer_id=(SELECT auth.uid())
     AND OLD.status='Received' AND NEW.status='Cancelled'
     AND v_new_payload=v_old_payload THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.delivery_handoff_confirm',true)='true'
     AND OLD.status='Handed Over' AND NEW.status='Completed'
     AND v_new_payload=v_old_payload THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_restaurant_role(OLD.restaurant_id,ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only the assigned Restaurant Owner can update marketplace order status.'
      USING ERRCODE='42501';
  END IF;
  IF v_new_payload IS DISTINCT FROM v_old_payload THEN
    RAISE EXCEPTION 'Restaurant Owner may update only order status and status note.'
      USING ERRCODE='42501';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.status_note IS DISTINCT FROM OLD.status_note THEN
    RAISE EXCEPTION 'Order status note can change only with an order status transition.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_owner_order_mutable_fields_trigger ON public.orders;
CREATE TRIGGER guard_owner_order_mutable_fields_trigger
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_owner_order_mutable_fields();
