-- Customer reporting of published reviews and Platform Admin moderation.
CREATE TABLE IF NOT EXISTS public.restaurant_review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.restaurant_reviews(id) ON DELETE CASCADE,
  reporter_customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('Fake or misleading','Abusive or inappropriate','Spam or advertising','Unrelated to restaurant','Other')),
  details text CHECK (details IS NULL OR length(details)<=1000),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Actioned','Dismissed')),
  reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note)<=500),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(review_id,reporter_customer_id)
);
CREATE INDEX IF NOT EXISTS restaurant_review_reports_status_created_idx ON public.restaurant_review_reports(status,created_at DESC);
CREATE INDEX IF NOT EXISTS restaurant_review_reports_reporter_idx ON public.restaurant_review_reports(reporter_customer_id);
CREATE INDEX IF NOT EXISTS restaurant_review_reports_review_id_idx ON public.restaurant_review_reports(review_id);
ALTER TABLE public.restaurant_review_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers and admins read review reports" ON public.restaurant_review_reports
  FOR SELECT TO authenticated USING (reporter_customer_id=(SELECT auth.uid()) OR public.is_platform_admin());
CREATE POLICY "Customers report published reviews" ON public.restaurant_review_reports
  FOR INSERT TO authenticated WITH CHECK (reporter_customer_id=(SELECT auth.uid()) AND EXISTS(
    SELECT 1 FROM public.restaurant_reviews rv WHERE rv.id=restaurant_review_reports.review_id AND rv.status='Published'));
CREATE POLICY "Platform admins update review reports" ON public.restaurant_review_reports
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
GRANT SELECT,INSERT ON public.restaurant_review_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_review_reports()
RETURNS TABLE(id uuid,review_id uuid,restaurant_name text,rating smallint,review_text text,
 reporter_customer_id uuid,reason text,details text,status text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
 RETURN QUERY SELECT rr.id,rv.id,r.name,rv.rating,rv.review,rr.reporter_customer_id,rr.reason,rr.details,rr.status,rr.created_at
 FROM public.restaurant_review_reports rr JOIN public.restaurant_reviews rv ON rv.id=rr.review_id
 JOIN public.restaurants r ON r.id=rv.restaurant_id
 ORDER BY CASE WHEN rr.status='Pending' THEN 0 ELSE 1 END,rr.created_at DESC LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_review_report(p_report_id uuid,p_decision text,p_review_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_report public.restaurant_review_reports%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
 IF p_decision NOT IN ('Hide Review','Dismiss') THEN RAISE EXCEPTION 'Choose Hide Review or Dismiss.'; END IF;
 SELECT * INTO v_report FROM public.restaurant_review_reports WHERE id=p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Review report not found.'; END IF;
 IF v_report.status<>'Pending' THEN RAISE EXCEPTION 'This review report has already been reviewed.'; END IF;
 IF p_decision='Hide Review' THEN
  UPDATE public.restaurant_reviews SET status='Hidden',updated_at=now() WHERE id=v_report.review_id;
  UPDATE public.restaurant_review_reports SET status='Actioned',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_review_note),'') WHERE id=v_report.id;
 ELSE
  UPDATE public.restaurant_review_reports SET status='Dismissed',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_review_note),'') WHERE id=v_report.id;
 END IF;
 INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
 VALUES(auth.uid(),'restaurant_review_report_'||lower(replace(p_decision,' ','_')),'restaurant_review_report',v_report.id,
 jsonb_build_object('review_id',v_report.review_id,'decision',p_decision));
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_review_reports() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_review_reports() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_review_report(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_review_report(uuid,text,text) TO authenticated;
