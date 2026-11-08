-- Audit customer-submitted profile/bank changes and review reports without logging sensitive payloads.
CREATE OR REPLACE FUNCTION public.audit_restaurant_change_request_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NOT NULL THEN
  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
  VALUES(auth.uid(),'restaurant_change_requested','restaurant_change_request',NEW.id,
    jsonb_build_object('restaurant_id',NEW.restaurant_id,'request_type',NEW.request_type));
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_audit_restaurant_change_request_insert AFTER INSERT ON public.restaurant_change_requests
FOR EACH ROW EXECUTE FUNCTION public.audit_restaurant_change_request_insert();
REVOKE ALL ON FUNCTION public.audit_restaurant_change_request_insert() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.audit_customer_review_report_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NOT NULL THEN
  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
  VALUES(auth.uid(),'customer_review_report_created','restaurant_review_report',NEW.id,
    jsonb_build_object('review_id',NEW.review_id,'reason',NEW.reason));
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_audit_customer_review_report_insert AFTER INSERT ON public.restaurant_review_reports
FOR EACH ROW EXECUTE FUNCTION public.audit_customer_review_report_insert();
REVOKE ALL ON FUNCTION public.audit_customer_review_report_insert() FROM PUBLIC,anon,authenticated;
