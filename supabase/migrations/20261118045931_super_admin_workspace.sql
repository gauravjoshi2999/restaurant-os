-- Super Admin workspace. Additive, no operational/payment records are rewritten.
CREATE OR REPLACE FUNCTION public.bite_super_admin_overview_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_start timestamptz := (timezone('Asia/Kolkata',now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
  RAISE EXCEPTION 'Super Admin access required' USING errcode='42501';
 END IF;
 RETURN jsonb_build_object(
  'business_date',timezone('Asia/Kolkata',now())::date,
  'orders_today',(SELECT count(*) FROM public.orders WHERE channel='Own Platform' AND is_demo IS NOT TRUE AND order_date>=v_start AND order_date<v_start+interval '1 day'),
  'collections_today',(SELECT coalesce(sum(f.customer_payable_amount),0) FROM public.order_financials f JOIN public.orders o ON o.id=f.order_id WHERE o.channel='Own Platform' AND f.channel='Own Platform' AND o.is_demo IS NOT TRUE AND f.is_demo IS NOT TRUE AND f.payment_status IN ('paid','partially_refunded','refunded') AND o.order_date>=v_start AND o.order_date<v_start+interval '1 day'),
  'pending_restaurants',(SELECT count(*) FROM public.restaurants WHERE onboarding_status='pending'),
  'delayed_orders',(SELECT count(*) FROM public.orders o JOIN public.restaurants r ON r.id=o.restaurant_id WHERE o.channel='Own Platform' AND o.is_demo IS NOT TRUE AND ((o.status IN ('Received','New') AND o.order_date<now()-interval '5 minutes') OR (o.status IN ('Accepted','Preparing','Ready') AND o.order_date<now()-make_interval(mins=>coalesce(r.estimated_prep_minutes,30)+15)))),
  'pending_settlements',(SELECT count(*) FROM public.restaurant_settlements WHERE status<>'paid'),
  'refund_followups',(SELECT count(*) FROM public.bite_refund_jobs j JOIN public.orders o ON o.id=j.order_id WHERE o.channel='Own Platform' AND o.is_demo IS NOT TRUE AND j.status NOT IN ('refunded','rejected','cancelled')),
  'owner_unassigned',(SELECT count(*) FROM public.restaurants r WHERE NOT EXISTS(SELECT 1 FROM public.restaurant_members m WHERE m.restaurant_id=r.id AND m.role='owner')),
  'open_support',(SELECT count(*) FROM public.customer_support_tickets WHERE status IN ('Open','In Progress')),
  'checked_at',now()
 );
END $$;

CREATE OR REPLACE FUNCTION public.bite_super_admin_review_v1(
 p_restaurant_id uuid,p_action text,p_note text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.restaurants%rowtype; v_before jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Super Admin access required' USING errcode='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('approve','request_changes','pause','publish') THEN RAISE EXCEPTION 'Unknown review action'; END IF;
 SELECT * INTO r FROM public.restaurants WHERE id=p_restaurant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
 IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Restaurant changed. Refresh the review before saving.' USING errcode='40001'; END IF;
 v_before:=jsonb_build_object('onboarding_status',r.onboarding_status,'status',r.status,'is_published',r.is_published);
 IF p_action IN ('approve','publish') THEN
  IF length(btrim(coalesce(r.name,'')))<2 OR length(btrim(coalesce(r.address,'')))<3 OR length(btrim(coalesce(r.phone,'')))<10 THEN RAISE EXCEPTION 'Complete restaurant name, address and phone before approval'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE restaurant_id=r.id AND is_available) THEN RAISE EXCEPTION 'At least one available menu item is required'; END IF;
  IF NOT coalesce(r.accepts_pickup,false) AND NOT (coalesce(r.accepts_delivery,false) AND EXISTS(SELECT 1 FROM public.restaurant_delivery_zones z JOIN public.restaurant_delivery_zone_pincodes p ON p.zone_id=z.id AND p.restaurant_id=z.restaurant_id WHERE z.restaurant_id=r.id AND z.is_active AND p.postal_code ~ '^[1-9][0-9]{5}$')) THEN RAISE EXCEPTION 'Configure an active delivery area or enable pickup before approval'; END IF;
 END IF;
 IF p_action='publish' AND (r.onboarding_status<>'approved' OR r.status<>'Active') THEN RAISE EXCEPTION 'Approve an active restaurant before publishing'; END IF;
 IF p_action='request_changes' AND (length(btrim(coalesce(p_note,'')))<5 OR length(btrim(p_note))>1000) THEN RAISE EXCEPTION 'Explain requested changes in 5–1000 characters'; END IF;
 UPDATE public.restaurants SET
  onboarding_status=CASE WHEN p_action='approve' THEN 'approved' WHEN p_action='request_changes' THEN 'rejected' ELSE onboarding_status END,
  status=CASE WHEN p_action='approve' THEN 'Active' WHEN p_action='request_changes' THEN 'Rejected' ELSE status END,
  is_published=(p_action='publish'),
  onboarding_rejection_reason=CASE WHEN p_action='request_changes' THEN btrim(p_note) WHEN p_action='approve' THEN NULL ELSE onboarding_rejection_reason END,
  onboarding_reviewed_by=auth.uid(),onboarding_reviewed_at=now(),updated_at=now()
 WHERE id=r.id;
 INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
 VALUES(auth.uid(),'restaurant_'||p_action,'restaurant',r.id,jsonb_build_object('before',v_before,'note',left(btrim(coalesce(p_note,'')),1000)));
 RETURN jsonb_build_object('saved',true,'restaurant_id',r.id,'action',p_action);
END $$;

CREATE OR REPLACE FUNCTION public.bite_super_admin_commission_v1(
 p_restaurant_id uuid,p_rate numeric,p_expected_rate numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_previous numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Super Admin access required' USING errcode='42501'; END IF;
 IF (p_restaurant_id IS NULL AND p_rate IS NULL) OR (p_rate IS NOT NULL AND (p_rate<0 OR p_rate>100 OR p_rate<>round(p_rate,2))) THEN RAISE EXCEPTION 'Commission must be 0–100 with at most two decimals'; END IF;
 IF p_restaurant_id IS NULL THEN
  SELECT default_commission_rate INTO v_previous FROM public.platform_settings WHERE id=1 FOR UPDATE;
 ELSE
  SELECT platform_commission_rate INTO v_previous FROM public.restaurants WHERE id=p_restaurant_id FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commission scope not found'; END IF;
 IF v_previous IS DISTINCT FROM p_expected_rate THEN RAISE EXCEPTION 'Commission changed. Reload before saving.' USING errcode='40001'; END IF;
 IF p_restaurant_id IS NULL THEN
  UPDATE public.platform_settings SET default_commission_rate=p_rate,updated_by=auth.uid(),updated_at=now() WHERE id=1;
 ELSE
  UPDATE public.restaurants SET platform_commission_rate=p_rate,updated_at=now() WHERE id=p_restaurant_id;
 END IF;
 INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
 VALUES(auth.uid(),'commission_updated',CASE WHEN p_restaurant_id IS NULL THEN 'platform_settings' ELSE 'restaurant' END,p_restaurant_id,jsonb_build_object('previous_rate',v_previous,'new_rate',p_rate,'scope',CASE WHEN p_restaurant_id IS NULL THEN 'default' ELSE 'restaurant' END,'applies_to','future checkout snapshots only'));
 RETURN jsonb_build_object('saved',true,'rate',p_rate);
END $$;
REVOKE ALL ON FUNCTION public.bite_super_admin_overview_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bite_super_admin_review_v1(uuid,text,text,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bite_super_admin_commission_v1(uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bite_super_admin_overview_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bite_super_admin_review_v1(uuid,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bite_super_admin_commission_v1(uuid,numeric,numeric) TO authenticated;

-- The attention lists and counts use the same predicates, across every page.
CREATE OR REPLACE FUNCTION public.bite_super_admin_attention_v1(p_kind text,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Super Admin access required' USING errcode='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Invalid page offset'; END IF;
 IF p_kind='delayed' THEN
  WITH matching AS (
   SELECT o.* FROM public.orders o JOIN public.restaurants r ON r.id=o.restaurant_id
   WHERE o.channel='Own Platform' AND o.is_demo IS NOT TRUE AND ((o.status IN ('Received','New') AND o.order_date<now()-interval '5 minutes') OR (o.status IN ('Accepted','Preparing','Ready') AND o.order_date<now()-make_interval(mins=>coalesce(r.estimated_prep_minutes,30)+15)))
  ), paged AS (SELECT * FROM matching ORDER BY order_date DESC,id LIMIT 25 OFFSET p_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM paged p),'[]'::jsonb),'total_count',(SELECT count(*) FROM matching)) INTO v_result;
 ELSIF p_kind='unassigned' THEN
  WITH matching AS (SELECT r.* FROM public.restaurants r WHERE NOT EXISTS(SELECT 1 FROM public.restaurant_members m WHERE m.restaurant_id=r.id AND m.role='owner')),
  paged AS (SELECT * FROM matching ORDER BY created_at DESC,id LIMIT 25 OFFSET p_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM paged p),'[]'::jsonb),'total_count',(SELECT count(*) FROM matching)) INTO v_result;
 ELSE RAISE EXCEPTION 'Unknown attention list';
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.bite_super_admin_attention_v1(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bite_super_admin_attention_v1(text,integer) TO authenticated;
