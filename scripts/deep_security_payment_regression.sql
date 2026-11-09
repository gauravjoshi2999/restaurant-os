-- All fixtures and business writes are rolled back; no provider call or charge.
DO $deep$
DECLARE
 owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
 customer_a uuid:=gen_random_uuid(); customer_b uuid:=gen_random_uuid();
 rid uuid:=gen_random_uuid(); foreign_rid uuid:=gen_random_uuid(); third_rid uuid:=gen_random_uuid();
 address_id uuid; meal uuid; intent uuid; verified_order_id uuid; null_order uuid:=gen_random_uuid();
 admin_id uuid; result jsonb:='[]'; blocked boolean; total numeric; actual_rate numeric;
BEGIN
 BEGIN
  SELECT user_id INTO admin_id FROM public.platform_admins LIMIT 1;
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT id,'authenticated','authenticated','deep-qa-'||id||'@bite.example','{}','{"full_name":"Ephemeral Deep QA"}',now(),now()
  FROM unnest(ARRAY[owner_a,owner_b,customer_a,customer_b]) id;
  INSERT INTO public.restaurants(id,name,created_by) VALUES(rid,'DEEP QA rollback A',owner_a),(foreign_rid,'DEEP QA rollback B',owner_b);
  INSERT INTO public.restaurants(id,name,created_by) VALUES(third_rid,'DEEP QA empty rollback',admin_id);
  INSERT INTO public.menu_items(restaurant_id,name,price,is_available) VALUES(rid,'QA meal',125,true) RETURNING id INTO meal;
  INSERT INTO public.orders(id,restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,delivery_type,is_demo)
  VALUES(null_order,rid,'QA-NULL-'||null_order,'Bite Demo Simulation',125,'Received',owner_a,null,'No customer linked','pickup',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.customer_cancel_order(null_order); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Unrelated customer cancelled an order with NULL customer_id'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Null-customer cancellation denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Null-customer cancellation denied','status','FAIL','error',SQLERRM)); END;
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.create_customer_order_request(null_order,'complaint','Test complaint'); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Unrelated customer request accepted'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Null-customer request denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Null-customer request denied','status','FAIL','error',SQLERRM)); END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN INSERT INTO public.restaurant_members(restaurant_id,user_id,role) VALUES(third_rid,owner_a,'owner'); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'An Owner was assigned to two restaurants'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','One restaurant per Owner enforced in DB','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','One restaurant per Owner enforced in DB','status','FAIL','error',SQLERRM)); END;
  UPDATE public.restaurants SET status='Active',onboarding_status='approved',is_published=true,platform_commission_rate=7.5 WHERE id=rid;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  PERFORM public.save_restaurant_delivery_zone(rid,null,'QA PIN',ARRAY['313324'],20,0,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  INSERT INTO public.customer_addresses(customer_id,recipient_name,recipient_phone,address_line,city,state,postal_code) VALUES(customer_a,'QA customer','9999999999','QA only','QA city','Rajasthan','313324') RETURNING id INTO address_id;
  intent:=public.bite_prepare_live_checkout(rid,'delivery',address_id,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',2)));
  SELECT amount INTO total FROM public.bite_live_checkout_intents WHERE id=intent;
  IF total<>270 THEN RAISE EXCEPTION 'Server price expected 270, got %',total; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('case','Server-priced subtotal and area delivery fee','status','PASS'));
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  UPDATE public.restaurants SET delivery_paused=true WHERE id=rid;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.bite_prepare_live_checkout(rid,'delivery',address_id,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',1))); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Payment intent created while restaurant delivery was paused'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Delivery pause blocks payment preparation','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Delivery pause blocks payment preparation','status','FAIL','error',SQLERRM)); END;
  BEGIN
   PERFORM public.bite_prepare_live_checkout(rid,'pickup',null,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',1)));
   result:=result||jsonb_build_array(jsonb_build_object('case','Delivery pause still permits pickup','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Delivery pause still permits pickup','status','FAIL','error',SQLERRM)); END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  UPDATE public.restaurants SET delivery_paused=false,is_temporarily_closed=true WHERE id=rid;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.bite_prepare_live_checkout(rid,'pickup',null,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',1))); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Payment intent created while restaurant temporarily closed'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Temporary closure blocks payment preparation','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Temporary closure blocks payment preparation','status','FAIL','error',SQLERRM)); END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  UPDATE public.restaurants SET is_temporarily_closed=false WHERE id=rid;
  UPDATE public.restaurants SET opening_time=((now() at time zone 'Asia/Kolkata')::time+interval '1 hour')::time,closing_time=((now() at time zone 'Asia/Kolkata')::time+interval '2 hours')::time WHERE id=rid;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.bite_prepare_live_checkout(rid,'pickup',null,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',1))); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Outside-hours payment preparation accepted'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Opening hours enforced before payment','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Opening hours enforced before payment','status','FAIL','error',SQLERRM)); END;
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.bite_finalize_verified_live_checkout(intent); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Customer activated an unverified checkout'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Customer cannot activate unpaid checkout','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Customer cannot activate unpaid checkout','status','FAIL','error',SQLERRM)); END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  UPDATE public.restaurants SET opening_time=null,closing_time=null WHERE id=rid;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','authenticated')::text,true);
  BEGIN
   blocked:=false;
   BEGIN PERFORM public.bite_prepare_live_checkout(rid,'pickup',null,null,jsonb_build_array(jsonb_build_object('menu_item_id',meal,'quantity',0))); EXCEPTION WHEN raise_exception OR insufficient_privilege THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Zero quantity accepted'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Invalid item quantity denied','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Invalid item quantity denied','status','FAIL','error',SQLERRM)); END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_a,'role','service_role')::text,true);
  UPDATE public.bite_live_checkout_intents SET status='payment_verified',provider_order_id='QA-ROLLBACK-ONLY-'||intent WHERE id=intent;
  BEGIN
   verified_order_id:=public.bite_finalize_verified_live_checkout(intent);
   SELECT commission_rate INTO actual_rate FROM public.order_financials WHERE public.order_financials.order_id=verified_order_id;
   IF actual_rate<>7.5 THEN RAISE EXCEPTION 'Restaurant rate 7.5 ignored; recorded %',actual_rate; END IF;
   IF public.bite_finalize_verified_live_checkout(intent)<>verified_order_id THEN RAISE EXCEPTION 'Repeated callback created a second order'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('case','Verified checkout respects restaurant commission override','status','PASS'));
  EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('case','Verified checkout respects restaurant commission override','status','FAIL','error',SQLERRM)); END;
  RAISE SQLSTATE 'ZX998' USING MESSAGE='Rollback all deep QA fixtures and simulated verified state';
 EXCEPTION WHEN SQLSTATE 'ZX998' THEN NULL;
 END;
 PERFORM set_config('bite.qa.deep_security_payment_result',result::text,false);
END $deep$;
SELECT current_setting('bite.qa.deep_security_payment_result')::jsonb AS checks;
