-- NULL customer links never authorize a Customer action. Existing grants and legitimate ownership flows are retained.

CREATE OR REPLACE FUNCTION public.create_customer_order_request(p_order_id uuid, p_request_type text, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders%rowtype; v_request_id uuid;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 if p_request_type not in ('cancel_request','complaint') then raise exception 'Invalid request type.'; end if;
 if p_message is null or length(btrim(p_message))<3 or length(btrim(p_message))>500 then
  raise exception 'Please enter a reason between 3 and 500 characters.';
 end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id IS DISTINCT FROM (SELECT auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if p_request_type='cancel_request' then
  if v_order.status not in ('Accepted','Preparing','Ready') then
   raise exception 'Cancellation request is available only before delivery handover.';
  end if;
  if exists(select 1 from public.restaurant_customer_order_requests r
    where r.order_id=v_order.id and r.request_type='cancel_request' and r.status='Pending') then
   raise exception 'A cancellation request is already pending for this order.';
  end if;
 elsif v_order.status<>'Completed' then
  raise exception 'You can report an issue after delivery is completed.';
 end if;
 insert into public.restaurant_customer_order_requests(restaurant_id,order_id,customer_id,request_type,message)
 values(v_order.restaurant_id,v_order.id,(select auth.uid()),p_request_type,btrim(p_message))
 returning id into v_request_id;
 return v_request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_restaurant_review(p_order_id uuid, p_rating integer, p_review text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_order public.orders%rowtype; v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Customer login required.'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be from 1 to 5 stars.'; END IF;
  IF p_review IS NULL OR length(btrim(p_review)) < 3 OR length(btrim(p_review)) > 500 THEN RAISE EXCEPTION 'Review must be 3 to 500 characters.'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Order not found for this customer.'; END IF;
  IF v_order.status <> 'Completed' THEN RAISE EXCEPTION 'Review can be submitted only after delivery is completed.'; END IF;
  INSERT INTO public.restaurant_reviews(restaurant_id,order_id,customer_id,rating,review,status)
  VALUES(v_order.restaurant_id,v_order.id,(SELECT auth.uid()),p_rating,btrim(p_review),'Published')
  RETURNING id INTO v_review_id;
  RETURN v_review_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_cancel_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id IS DISTINCT FROM (SELECT auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if v_order.status<>'Received' then raise exception 'Direct cancellation is available only before restaurant acceptance. Submit a cancellation request instead.'; end if;
 perform set_config('app.customer_cancel','true',true);
 update public.orders set status='Cancelled',status_note='Cancelled by customer before restaurant acceptance' where id=v_order.id;
 return true;
end;
$function$;
