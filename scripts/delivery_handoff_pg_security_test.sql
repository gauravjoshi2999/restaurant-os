-- Isolated PostgreSQL17 tests of actual deployed delivery handoff functions.
-- All records are synthetic and live inside a CI-only PostgreSQL service.
-- No Supabase URLs, production credentials, phone numbers or real orders.
\set ON_ERROR_STOP on
BEGIN;
DO $qa$
DECLARE
 a_owner uuid := '00000000-0000-4000-8000-000000000101';
 b_owner uuid := '00000000-0000-4000-8000-000000000102';
 customer uuid := '00000000-0000-4000-8000-000000000103';
 outsider uuid := '00000000-0000-4000-8000-000000000104';
 a_rest uuid := '00000000-0000-4000-8000-000000000201';
 b_rest uuid := '00000000-0000-4000-8000-000000000202';
 a_order uuid := '00000000-0000-4000-8000-000000000301';
 b_order uuid := '00000000-0000-4000-8000-000000000302';
 exp_order uuid := '00000000-0000-4000-8000-000000000303';
 token_a text; rotated_token text; expired_token text; otp text;
 tries int; denied boolean; visible_count int;
BEGIN
 INSERT INTO auth.users(id) VALUES(a_owner),(b_owner),(customer),(outsider);
 INSERT INTO public.restaurants(id,name) VALUES(a_rest,'QA Restaurant A'),(b_rest,'QA Restaurant B');
 INSERT INTO public.restaurant_members(restaurant_id,user_id,role)
 VALUES(a_rest,a_owner,'owner'),(b_rest,b_owner,'owner');
 INSERT INTO public.orders(id,restaurant_id,order_code,customer_id,customer_name,customer_phone,
                           delivery_address_snapshot,delivery_type,status)
 VALUES
 (a_order,a_rest,'QA-A-1',customer,'Fake customer A','0000000000','{"city":"QA-only"}','delivery','Ready'),
 (b_order,b_rest,'QA-B-1',customer,'Fake customer B','0000000000','{"city":"QA-only"}','delivery','Ready'),
 (exp_order,a_rest,'QA-A-EXPIRED',customer,'Fake customer A','0000000000','{"city":"QA-only"}','delivery','Ready');
 INSERT INTO public.order_items(order_id,item_name,quantity,unit_price,line_total)
 VALUES(a_order,'QA no-money dish',1,99,99);

 IF has_table_privilege('anon','public.restaurant_delivery_handoffs','SELECT')
    OR has_table_privilege('authenticated','public.restaurant_delivery_handoffs','SELECT') THEN
   RAISE EXCEPTION 'Public direct handoff table read must stay revoked';
 END IF;
 IF has_function_privilege('anon','public.create_delivery_handoff(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.get_my_delivery_otp(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Anonymous privilege is too broad';
 END IF;
 RAISE NOTICE 'PASS: direct handoff table and privileged RPCs inaccessible anonymously';

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a_owner,'role','authenticated')::text,true);
 denied := false;
 BEGIN
   PERFORM public.create_delivery_handoff(b_order);
 EXCEPTION WHEN OTHERS THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Owner A created Owner B delivery link'; END IF;
 RAISE NOTICE 'PASS: other-restaurant owner cannot mint delivery link';

 SELECT h.token INTO token_a FROM public.create_delivery_handoff(a_order) h;
 IF token_a IS NULL OR length(token_a)<>64 THEN
   RAISE EXCEPTION 'Unexpected handoff link token length';
 END IF;
 IF EXISTS(SELECT 1 FROM public.get_my_delivery_otp(a_order)) THEN
   RAISE EXCEPTION 'Owner read customer-only OTP';
 END IF;
 RAISE NOTICE 'PASS: correct Owner minted 64-digit link without seeing customer OTP';

 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{}',true);
 IF (SELECT count(*) FROM public.get_delivery_handoff(token_a))<>1 THEN
   RAISE EXCEPTION 'Bearer token did not retrieve active delivery';
 END IF;
 IF EXISTS(SELECT 1 FROM public.get_delivery_handoff('not-a-token')) THEN
   RAISE EXCEPTION 'Invalid bearer token returned customer address';
 END IF;
 denied := false;
 BEGIN
   PERFORM public.confirm_delivery_handoff(token_a,'9999');
 EXCEPTION WHEN OTHERS THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Delivery confirmed before Owner handover'; END IF;
 RAISE NOTICE 'PASS: bearer lookup requires token and OTP verification is denied before handover';

 EXECUTE 'RESET ROLE';
 SELECT otp_attempts INTO tries FROM public.restaurant_delivery_handoffs
 WHERE token_hash=extensions.digest(token_a,'sha256');
 IF tries<>0 THEN RAISE EXCEPTION 'Premature OTP attempt changed rate counter'; END IF;
 UPDATE public.orders SET status='Handed Over' WHERE id=a_order;

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.get_my_delivery_otp(a_order)) THEN
   RAISE EXCEPTION 'Unrelated authenticated user saw customer OTP';
 END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
 SELECT o.delivery_otp INTO otp FROM public.get_my_delivery_otp(a_order) o;
 IF otp IS NULL OR otp !~ '^[0-9]{4}$' THEN
   RAISE EXCEPTION 'Real customer could not read 4-digit OTP';
 END IF;
 RAISE NOTICE 'PASS: only real customer of synthetic order can obtain OTP';

 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{}',true);
 FOR i IN 1..5 LOOP
   IF public.confirm_delivery_handoff(token_a,'invalid') THEN
     RAISE EXCEPTION 'Wrong OTP accepted at attempt %',i;
   END IF;
 END LOOP;
 denied := false;
 BEGIN PERFORM public.confirm_delivery_handoff(token_a,otp);
 EXCEPTION WHEN OTHERS THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Sixth OTP attempt was accepted'; END IF;
 EXECUTE 'RESET ROLE';
 SELECT otp_attempts INTO tries FROM public.restaurant_delivery_handoffs
 WHERE token_hash=extensions.digest(token_a,'sha256');
 IF tries<>5 THEN RAISE EXCEPTION 'Five bad OTP tries recorded % instead',tries; END IF;
 RAISE NOTICE 'PASS: five attempts counted, sixth attempt blocked';

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a_owner,'role','authenticated')::text,true);
 SELECT h.token INTO rotated_token FROM public.create_delivery_handoff(a_order) h;
 IF rotated_token IS NULL OR rotated_token=token_a THEN
   RAISE EXCEPTION 'Owner link rotation did not generate a new token';
 END IF;
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{}',true);
 IF EXISTS(SELECT 1 FROM public.get_delivery_handoff(token_a)) THEN
   RAISE EXCEPTION 'Rotated old token still accesses address';
 END IF;
 RAISE NOTICE 'PASS: rotated link invalidates old token';

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
 SELECT o.delivery_otp INTO otp FROM public.get_my_delivery_otp(a_order) o;
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{}',true);
 IF NOT public.confirm_delivery_handoff(rotated_token,otp) THEN
   RAISE EXCEPTION 'Correct customer OTP rejected';
 END IF;
 IF EXISTS(SELECT 1 FROM public.get_delivery_handoff(rotated_token)) THEN
   RAISE EXCEPTION 'Consumed delivery token remains accessible';
 END IF;
 denied := false;
 BEGIN PERFORM public.confirm_delivery_handoff(rotated_token,otp);
 EXCEPTION WHEN OTHERS THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'OTP reuse was allowed'; END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT status FROM public.orders WHERE id=a_order)<>'Completed' THEN
   RAISE EXCEPTION 'Delivery status not Completed';
 END IF;
 IF (SELECT count(*) FROM public.order_status_history WHERE order_id=a_order AND to_status='Completed')<>1 THEN
   RAISE EXCEPTION 'Expected exactly one delivered status event';
 END IF;
 RAISE NOTICE 'PASS: customer OTP completes exactly once; old link, PII and repeated confirmation blocked';

 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a_owner,'role','authenticated')::text,true);
 SELECT h.token INTO expired_token FROM public.create_delivery_handoff(exp_order) h;
 EXECUTE 'RESET ROLE';
 UPDATE public.restaurant_delivery_handoffs SET expires_at=now()-interval '1 second'
 WHERE token_hash=extensions.digest(expired_token,'sha256');
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM set_config('request.jwt.claims','{}',true);
 IF EXISTS(SELECT 1 FROM public.get_delivery_handoff(expired_token)) THEN
   RAISE EXCEPTION 'Expired token exposes customer data';
 END IF;
 denied := false;
 BEGIN PERFORM public.confirm_delivery_handoff(expired_token,'0000');
 EXCEPTION WHEN OTHERS THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Expired token accepted for confirmation'; END IF;
 RAISE NOTICE 'PASS: expired token can neither read customer details nor complete order';
 RAISE NOTICE 'PASS: all cases used synthetic fixture; no live records touched';
END $qa$;
ROLLBACK;
