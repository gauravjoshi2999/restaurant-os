-- Requires the existing unpublished dedicated QA restaurant. No new Auth identities are created.
DO $null_ownership$
DECLARE rid uuid; owner_id uuid; test_customer uuid; done_id uuid:=gen_random_uuid(); accepted_id uuid:=gen_random_uuid(); owned_id uuid:=gen_random_uuid(); results jsonb:='[]'; blocked boolean;
BEGIN
 BEGIN
  SELECT r.id,m.user_id INTO rid,owner_id FROM public.restaurants r JOIN public.restaurant_members m ON m.restaurant_id=r.id AND m.role='owner' WHERE r.name='Bite QA — temporary owner test' AND NOT r.is_published LIMIT 1;
  SELECT p.id INTO test_customer FROM public.profiles p WHERE NOT EXISTS(SELECT FROM public.restaurant_members m WHERE m.user_id=p.id) AND NOT EXISTS(SELECT FROM public.platform_admins a WHERE a.user_id=p.id) LIMIT 1;
  IF rid IS NULL OR owner_id IS NULL OR test_customer IS NULL THEN RAISE EXCEPTION 'Dedicated QA fixtures unavailable'; END IF;
  INSERT INTO public.orders(id,restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,delivery_type,is_demo)
  VALUES(done_id,rid,'QA-NULL-'||done_id,'Bite Demo Simulation',1,'Received',owner_id,null,'Rollback-only unlinked order','pickup',true),
  (accepted_id,rid,'QA-NULL-'||accepted_id,'Bite Demo Simulation',1,'Received',owner_id,null,'Rollback-only unlinked order','pickup',true),
  (owned_id,rid,'QA-OWNED-'||owned_id,'Bite Demo Simulation',1,'Received',owner_id,test_customer,'Rollback-only linked order','pickup',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  UPDATE public.orders SET status='Accepted' WHERE id IN(done_id,accepted_id,owned_id);
  UPDATE public.orders SET status='Preparing' WHERE id IN(done_id,owned_id);
  UPDATE public.orders SET status='Ready' WHERE id IN(done_id,owned_id);
  UPDATE public.orders SET status='Handed Over' WHERE id IN(done_id,owned_id);
  UPDATE public.orders SET status='Completed' WHERE id IN(done_id,owned_id);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',test_customer,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;BEGIN PERFORM public.create_customer_restaurant_review(done_id,5,'Rollback-only ownership probe');EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true;END;
   IF NOT blocked THEN RAISE EXCEPTION 'An unrelated customer reviewed an unlinked completed order';END IF;
   results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked completed-order review denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked completed-order review denied','status','FAIL','error',SQLERRM));END;
  BEGIN
   blocked:=false;BEGIN PERFORM public.create_customer_order_request(done_id,'complaint','Rollback-only complaint probe');EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true;END;
   IF NOT blocked THEN RAISE EXCEPTION 'An unrelated customer complained on an unlinked completed order';END IF;
   results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked completed-order complaint denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked completed-order complaint denied','status','FAIL','error',SQLERRM));END;
  BEGIN
   blocked:=false;BEGIN PERFORM public.create_customer_order_request(accepted_id,'cancel_request','Rollback-only cancellation probe');EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true;END;
   IF NOT blocked THEN RAISE EXCEPTION 'An unrelated customer requested cancellation of an unlinked accepted order';END IF;
   results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked accepted-order cancellation request denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN results:=results||jsonb_build_array(jsonb_build_object('case','Unlinked accepted-order cancellation request denied','status','FAIL','error',SQLERRM));END;
  PERFORM public.create_customer_restaurant_review(owned_id,5,'Valid rollback-only owned review');
  PERFORM public.create_customer_order_request(owned_id,'complaint','Valid rollback-only owned complaint');
  results:=results||jsonb_build_array(jsonb_build_object('case','Legitimate linked Customer review and complaint still work','status','PASS'));
  RAISE SQLSTATE 'ZX996' USING MESSAGE='Rollback every null-ownership fixture and test write';
 EXCEPTION WHEN SQLSTATE 'ZX996' THEN NULL;
 END;
 PERFORM set_config('bite.qa.null_ownership_result',results::text,false);
END $null_ownership$;
SELECT current_setting('bite.qa.null_ownership_result')::jsonb AS checks;
