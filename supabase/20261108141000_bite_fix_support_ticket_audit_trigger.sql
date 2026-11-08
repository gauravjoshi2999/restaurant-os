-- Trigger return handling correction for calls without an authenticated user.
CREATE OR REPLACE FUNCTION public.audit_support_ticket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_action text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    v_action:='customer_support_ticket_created';
    INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),v_action,'customer_support_ticket',NEW.id,
      jsonb_build_object('category',NEW.category,'subject',NEW.subject,'status',NEW.status,'order_id',NEW.order_id));
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.admin_response IS DISTINCT FROM OLD.admin_response THEN
    v_action:='customer_support_ticket_updated';
    INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),v_action,'customer_support_ticket',NEW.id,
      jsonb_build_object('old_status',OLD.status,'new_status',NEW.status,'response_changed',NEW.admin_response IS DISTINCT FROM OLD.admin_response));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_support_ticket_change() FROM PUBLIC,anon,authenticated;
