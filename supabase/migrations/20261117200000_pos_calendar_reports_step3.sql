-- Bite POS step 3: true date-scoped restaurant reports, read-only.
-- Customer online orders and hotel room-posted food must never become counter POS.
-- Distinguish diners recorded in modern bills from historical unknown counts.
CREATE OR REPLACE FUNCTION public.bite_pos_reports_v1(
 p_restaurant_id uuid, p_month date, p_day date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=''
AS $body$
DECLARE
 v_month date;
 v_end date;
 v_day date;
 v_report jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_restaurant_role(p_restaurant_id,ARRAY['owner','manager']::text[]) THEN
  RAISE EXCEPTION 'Authorized restaurant Owner/Manager required' USING errcode='42501';
 END IF;
 IF p_month IS NULL THEN RAISE EXCEPTION 'Select a report month'; END IF;
 v_month:=date_trunc('month',p_month::timestamp)::date;
 v_end:=(v_month+interval '1 month')::date;
 IF v_month < date '2020-01-01' OR v_month > (date_trunc('month',timezone('Asia/Kolkata',now()))+interval '12 months')::date THEN
  RAISE EXCEPTION 'Report month outside supported window';
 END IF;
 v_day:=COALESCE(p_day,CASE WHEN date_trunc('month',timezone('Asia/Kolkata',now()))::date=v_month THEN timezone('Asia/Kolkata',now())::date ELSE v_month END);
 IF v_day<v_month OR v_day>=v_end THEN
  RAISE EXCEPTION 'Selected day must be in report month';
 END IF;
 WITH cancelled_amounts AS (
  SELECT order_id,SUM(cancelled_sale_amount)::numeric AS cancelled
  FROM public.restaurant_order_refunds
  WHERE restaurant_id=p_restaurant_id
  GROUP BY order_id
 ), base AS (
  SELECT o.id,o.order_code,o.customer_name,o.channel,o.status,o.order_date,
   (timezone('Asia/Kolkata',o.order_date))::date AS day,
   round(greatest(0::numeric,o.amount - COALESCE(o.waived_off_amount,0) - COALESCE(ca.cancelled,0)),2) AS billed,
   visit.visit_type,visit.guest_count
  FROM public.orders o
  LEFT JOIN public.restaurant_pos_visit_details visit
   ON visit.order_id=o.id AND visit.restaurant_id=o.restaurant_id
  LEFT JOIN cancelled_amounts ca ON ca.order_id=o.id
  WHERE o.restaurant_id=p_restaurant_id
   AND o.channel IN ('POS - Counter','POS - Dine-in','POS - Takeaway')
   AND o.is_demo IS NOT TRUE
   AND o.status NOT IN ('Cancelled','Rejected')
   AND o.order_date >= (v_month::timestamp AT TIME ZONE 'Asia/Kolkata')
   AND o.order_date < (v_end::timestamp AT TIME ZONE 'Asia/Kolkata')
   AND o.order_code NOT LIKE 'POS-ROOM-%'
   AND NOT EXISTS (
    SELECT 1 FROM public.bite_property_commands pc
    WHERE pc.action='room_pos'
     AND pc.result->>'order_id'=o.id::text
   )
 ), daily AS (
  SELECT day,COUNT(*)::int AS bills,
   COALESCE(SUM(billed),0)::numeric AS billed,
   COUNT(*) FILTER (WHERE visit_type='dine_in')::int AS dine_in,
   COUNT(*) FILTER (WHERE visit_type='takeaway')::int AS takeaway,
   COUNT(*) FILTER (WHERE visit_type IS NULL)::int AS untracked,
   COALESCE(SUM(guest_count) FILTER (WHERE visit_type='dine_in'),0)::int AS guests
  FROM base GROUP BY day
 ), days AS (
  SELECT gs::date AS day FROM generate_series(v_month::timestamp,(v_end-1)::timestamp,interval '1 day') gs
 )
 SELECT jsonb_build_object(
  'month',to_char(v_month,'YYYY-MM'),
  'selected_day',to_char(v_day,'YYYY-MM-DD'),
  'days',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
    'date',to_char(d.day,'YYYY-MM-DD'),
    'bills',COALESCE(x.bills,0),
    'billed',COALESCE(x.billed,0),
    'guests',COALESCE(x.guests,0),
    'dine_in',COALESCE(x.dine_in,0),
    'takeaway',COALESCE(x.takeaway,0),
    'untracked',COALESCE(x.untracked,0)
   ) ORDER BY d.day)
   FROM days d LEFT JOIN daily x ON x.day=d.day
  ),'[]'::jsonb),
  'recent',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
    'id',z.id,'code',z.order_code,'customer',COALESCE(nullif(z.customer_name,''),'Walk-in'),
    'billed',z.billed,'service',COALESCE(z.visit_type,'untracked'),
    'guests',CASE WHEN z.visit_type='dine_in' THEN z.guest_count ELSE NULL END,
    'status',z.status
   ) ORDER BY z.order_date DESC)
   FROM (SELECT * FROM base WHERE day=v_day ORDER BY order_date DESC LIMIT 8) z
  ),'[]'::jsonb)
 ) INTO v_report;
 RETURN v_report;
END $body$;
REVOKE ALL ON FUNCTION public.bite_pos_reports_v1(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bite_pos_reports_v1(uuid,date,date) TO authenticated;
