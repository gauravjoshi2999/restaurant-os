-- Dedicated unpublished QA restaurant only. All orders, users and handoffs roll back.
BEGIN;
DO $test$
DECLARE
  owner_id uuid := '__OWNER_ID__';
  rid uuid := '__RESTAURANT_ID__';
  customer_id uuid := gen_random_uuid();
  delivery_id uuid := gen_random_uuid();
  pickup_id uuid := gen_random_uuid();
  token1 text; token2 text; otp text; result jsonb := '[]';
BEGIN
  BEGIN
    INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      VALUES(customer_id,'authenticated','authenticated','delivery-qa-'||customer_id||'@bite.example','{}','{"full_name":"QA customer"}',now(),now());
    INSERT INTO public.orders(id,restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,delivery_type,delivery_address_snapshot,is_demo)
      VALUES(delivery_id,rid,'QA-DELIVERY-'||delivery_id,'Bite Demo Simulation',100,'Received',owner_id,customer_id,'QA customer','delivery','{"address_line":"QA only","city":"QA","postal_code":"313324"}',true),
      (pickup_id,rid,'QA-PICKUP-'||pickup_id,'Bite Demo Simulation',100,'Received',owner_id,customer_id,'QA customer','pickup',null,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
    UPDATE public.orders SET status='Accepted' WHERE id IN (delivery_id,pickup_id);
    UPDATE public.orders SET status='Preparing' WHERE id IN (delivery_id,pickup_id);
    UPDATE public.orders SET status='Ready' WHERE id IN (delivery_id,pickup_id);
    BEGIN
      UPDATE public.orders SET status='Handed Over' WHERE id=delivery_id;
      RAISE EXCEPTION 'Delivery handover without link was allowed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Delivery handover without link was allowed' THEN RAISE; END IF;
    END;
    SELECT h.token INTO token1 FROM public.create_delivery_handoff(delivery_id) h;
    IF length(token1)<>64 THEN RAISE EXCEPTION 'Unexpected token entropy'; END IF;
    IF EXISTS(SELECT FROM public.get_my_delivery_otp(delivery_id)) THEN RAISE EXCEPTION 'OTP exposed to Owner'; END IF;
    UPDATE public.orders SET status='Handed Over' WHERE id=delivery_id;
    UPDATE public.orders SET status='Handed Over' WHERE id=pickup_id;
    UPDATE public.orders SET status='Completed' WHERE id=pickup_id;
    result := result || '"Owner accept, prepare, ready, protected delivery handover and pickup completion"';
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims','{}',true);
    IF NOT EXISTS(SELECT FROM public.get_delivery_handoff(token1)) THEN RAISE EXCEPTION 'Bearer link lookup failed'; END IF;
    FOR i IN 1..5 LOOP
      IF public.confirm_delivery_handoff(token1,'invalid') THEN RAISE EXCEPTION 'Invalid OTP accepted'; END IF;
    END LOOP;
    BEGIN
      PERFORM public.confirm_delivery_handoff(token1,'0000');
      RAISE EXCEPTION 'Sixth OTP attempt was allowed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Sixth OTP attempt was allowed' THEN RAISE; END IF;
    END;
    result := result || '"Public delivery link and five-attempt OTP lock"';
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
    SELECT h.token INTO token2 FROM public.create_delivery_handoff(delivery_id) h;
    IF token2=token1 THEN RAISE EXCEPTION 'Recovery reused an old token'; END IF;
    IF EXISTS(SELECT FROM public.get_delivery_handoff(token1)) THEN RAISE EXCEPTION 'Rotated link still works'; END IF;
    PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_id,'role','authenticated')::text,true);
    SELECT h.delivery_otp INTO otp FROM public.get_my_delivery_otp(delivery_id) h;
    IF otp IS NULL OR otp!~'^[0-9]{4}$' THEN RAISE EXCEPTION 'Customer OTP retrieval failed'; END IF;
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims','{}',true);
    IF NOT public.confirm_delivery_handoff(token2,otp) THEN RAISE EXCEPTION 'Correct OTP was rejected'; END IF;
    IF EXISTS(SELECT FROM public.get_delivery_handoff(token2)) THEN RAISE EXCEPTION 'Completed link was not consumed'; END IF;
    result := result || '"Owner link recovery after handover, old-token invalidation, Customer-only OTP and completion"';
    RAISE SQLSTATE 'ZX002' USING MESSAGE='Rollback all delivery QA data';
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN
    PERFORM set_config('bite.qa.delivery_result',result::text,false);
  END;
END $test$;
COMMIT;
SELECT current_setting('bite.qa.delivery_result')::jsonb AS passed_checks;
