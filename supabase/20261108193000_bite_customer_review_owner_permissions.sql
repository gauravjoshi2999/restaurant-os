-- Publish reviews only after completed-order verification; only the restaurant Owner may reply.
-- Owners must never be able to hide or suppress a customer's review.
CREATE OR REPLACE FUNCTION public.create_customer_restaurant_review(
  p_order_id uuid, p_rating integer, p_review text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_order public.orders%rowtype; v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Customer login required.'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be from 1 to 5 stars.'; END IF;
  IF p_review IS NULL OR length(btrim(p_review)) < 3 OR length(btrim(p_review)) > 500 THEN RAISE EXCEPTION 'Review must be 3 to 500 characters.'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id <> (SELECT auth.uid()) THEN RAISE EXCEPTION 'Order not found for this customer.'; END IF;
  IF v_order.status <> 'Completed' THEN RAISE EXCEPTION 'Review can be submitted only after delivery is completed.'; END IF;
  INSERT INTO public.restaurant_reviews(restaurant_id,order_id,customer_id,rating,review,status)
  VALUES(v_order.restaurant_id,v_order.id,(SELECT auth.uid()),p_rating,btrim(p_review),'Published')
  RETURNING id INTO v_review_id;
  RETURN v_review_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_restaurant_review(
  p_review_id uuid, p_response text, p_publish boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_review public.restaurant_reviews%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Restaurant login required.'; END IF;
  SELECT * INTO v_review FROM public.restaurant_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found.'; END IF;
  IF NOT public.has_restaurant_role(v_review.restaurant_id, ARRAY['owner']) THEN RAISE EXCEPTION 'Only the Restaurant Owner can reply to customer reviews.'; END IF;
  IF p_publish IS DISTINCT FROM true THEN RAISE EXCEPTION 'A Restaurant Owner cannot hide a customer review.'; END IF;
  IF p_response IS NULL OR length(btrim(p_response)) < 3 OR length(btrim(p_response)) > 500 THEN RAISE EXCEPTION 'Reply must be 3 to 500 characters.'; END IF;
  IF v_review.status <> 'Published' THEN RAISE EXCEPTION 'Only published reviews can receive a reply.'; END IF;
  UPDATE public.restaurant_reviews
  SET response=btrim(p_response),responded_by=(SELECT auth.uid()),responded_at=now(),updated_at=now()
  WHERE id=v_review.id;
  RETURN true;
END;
$function$;

DROP POLICY IF EXISTS "owners managers respond to reviews" ON public.restaurant_reviews;
REVOKE UPDATE ON TABLE public.restaurant_reviews FROM PUBLIC, anon, authenticated;

UPDATE public.restaurant_reviews rv
SET status='Published',updated_at=now()
WHERE rv.status='Pending'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id=rv.order_id AND o.customer_id=rv.customer_id
      AND o.restaurant_id=rv.restaurant_id AND o.status='Completed'
  );

REVOKE ALL ON FUNCTION public.create_customer_restaurant_review(uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_restaurant_review(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.respond_restaurant_review(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_restaurant_review(uuid,text,boolean) TO authenticated;
