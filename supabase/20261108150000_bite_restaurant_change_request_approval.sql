-- Owner identity and payout changes require Platform Admin approval.
CREATE TABLE IF NOT EXISTS public.restaurant_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  request_type text NOT NULL CHECK (request_type IN ('profile','bank_details')),
  proposed_values jsonb NOT NULL CHECK (jsonb_typeof(proposed_values)='object'),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note)<=500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_change_requests_status_created_idx ON public.restaurant_change_requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS restaurant_change_requests_restaurant_idx ON public.restaurant_change_requests(restaurant_id,created_at DESC);
ALTER TABLE public.restaurant_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and admins read restaurant change requests" ON public.restaurant_change_requests
  FOR SELECT TO authenticated USING (public.is_platform_admin() OR (public.has_restaurant_role(restaurant_id,ARRAY['owner']) AND requested_by=(SELECT auth.uid())));
CREATE POLICY "Owners submit restaurant change requests" ON public.restaurant_change_requests
  FOR INSERT TO authenticated WITH CHECK (requested_by=(SELECT auth.uid()) AND public.has_restaurant_role(restaurant_id,ARRAY['owner']));
GRANT SELECT,INSERT ON public.restaurant_change_requests TO authenticated;

CREATE TABLE IF NOT EXISTS public.restaurant_payout_profiles (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  account_holder_name text NOT NULL, bank_name text NOT NULL, account_number text NOT NULL,
  ifsc_code text NOT NULL, upi_id text,
  approval_status text NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending','Approved','Rejected')),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.restaurant_payout_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and admins read payout profiles" ON public.restaurant_payout_profiles
  FOR SELECT TO authenticated USING (public.is_platform_admin() OR public.has_restaurant_role(restaurant_id,ARRAY['owner']));
GRANT SELECT ON public.restaurant_payout_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_unapproved_restaurant_identity_change()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() AND
    (NEW.name IS DISTINCT FROM OLD.name OR NEW.address IS DISTINCT FROM OLD.address) THEN
    RAISE EXCEPTION 'Restaurant name and address changes require Platform Admin approval. Submit a change request in Settings.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_prevent_unapproved_restaurant_identity_change
BEFORE UPDATE OF name,address ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.prevent_unapproved_restaurant_identity_change();
REVOKE ALL ON FUNCTION public.prevent_unapproved_restaurant_identity_change() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_restaurant_change_requests()
RETURNS TABLE(id uuid,restaurant_id uuid,restaurant_name text,requested_by uuid,request_type text,
  proposed_values jsonb,status text,review_note text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
  RETURN QUERY SELECT cr.id,cr.restaurant_id,r.name,cr.requested_by,cr.request_type,cr.proposed_values,cr.status,cr.review_note,cr.created_at
  FROM public.restaurant_change_requests cr JOIN public.restaurants r ON r.id=cr.restaurant_id
  ORDER BY CASE WHEN cr.status='Pending' THEN 0 ELSE 1 END,cr.created_at DESC LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_restaurant_change_request(p_request_id uuid,p_decision text,p_review_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_req public.restaurant_change_requests%rowtype; v_holder text; v_bank text; v_account text; v_ifsc text; v_upi text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
  IF p_decision NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Choose Approved or Rejected.'; END IF;
  IF p_review_note IS NOT NULL AND length(btrim(p_review_note))>500 THEN RAISE EXCEPTION 'Review note must be 500 characters or fewer.'; END IF;
  SELECT * INTO v_req FROM public.restaurant_change_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change request not found.'; END IF;
  IF v_req.status<>'Pending' THEN RAISE EXCEPTION 'This change request has already been reviewed.'; END IF;
  IF p_decision='Approved' AND v_req.request_type='profile' THEN
    IF nullif(btrim(v_req.proposed_values->>'name'),'') IS NULL OR length(btrim(v_req.proposed_values->>'name'))>140
      OR nullif(btrim(v_req.proposed_values->>'address'),'') IS NULL OR length(btrim(v_req.proposed_values->>'address'))>400 THEN
      RAISE EXCEPTION 'Proposed restaurant name or address is invalid.';
    END IF;
    UPDATE public.restaurants SET name=btrim(v_req.proposed_values->>'name'),address=btrim(v_req.proposed_values->>'address') WHERE id=v_req.restaurant_id;
  ELSIF p_decision='Approved' AND v_req.request_type='bank_details' THEN
    v_holder:=btrim(coalesce(v_req.proposed_values->>'account_holder_name',''));
    v_bank:=btrim(coalesce(v_req.proposed_values->>'bank_name',''));
    v_account:=regexp_replace(coalesce(v_req.proposed_values->>'account_number',''),'[^0-9]','','g');
    v_ifsc:=upper(btrim(coalesce(v_req.proposed_values->>'ifsc_code','')));
    v_upi:=nullif(btrim(v_req.proposed_values->>'upi_id'),'');
    IF length(v_holder)<2 OR length(v_holder)>120 OR length(v_bank)<2 OR length(v_bank)>120
      OR length(v_account)<9 OR length(v_account)>18 OR v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN
      RAISE EXCEPTION 'Bank details are invalid. Verify account holder, bank, account number and IFSC.';
    END IF;
    INSERT INTO public.restaurant_payout_profiles(restaurant_id,account_holder_name,bank_name,account_number,ifsc_code,upi_id,approval_status,updated_at,updated_by)
    VALUES(v_req.restaurant_id,v_holder,v_bank,v_account,v_ifsc,v_upi,'Approved',now(),auth.uid())
    ON CONFLICT(restaurant_id) DO UPDATE SET account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,
      account_number=excluded.account_number,ifsc_code=excluded.ifsc_code,upi_id=excluded.upi_id,approval_status='Approved',updated_at=now(),updated_by=auth.uid();
  END IF;
  UPDATE public.restaurant_change_requests SET status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_review_note),'') WHERE id=v_req.id;
  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
  VALUES(auth.uid(),'restaurant_change_request_'||lower(p_decision),'restaurant_change_request',v_req.id,
    jsonb_build_object('restaurant_id',v_req.restaurant_id,'request_type',v_req.request_type,'decision',p_decision));
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_restaurant_change_requests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_change_requests() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_restaurant_change_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_restaurant_change_request(uuid,text,text) TO authenticated;
