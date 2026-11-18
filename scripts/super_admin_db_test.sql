\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.expect_error(query text,wanted text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=wanted THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected SQLSTATE %: %',wanted,query; END $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.bite_super_admin_overview_v1()','execute'),'Anonymous role cannot execute overview');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.bite_super_admin_review_v1(uuid,text,text,timestamptz)','execute'),'Anonymous role cannot execute restaurant review');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.bite_super_admin_commission_v1(uuid,numeric,numeric)','execute'),'Anonymous role cannot change commission');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.bite_super_admin_attention_v1(text,integer)','execute'),'Anonymous role cannot read attention lists');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT pg_temp.expect_error('select public.bite_super_admin_overview_v1()','42501');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pause','',null)$q$,'42501');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,15,10)','42501');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_attention_v1('delayed',0)$q$,'42501');
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SELECT pg_temp.expect_error('select public.bite_super_admin_overview_v1()','42501');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,15,10)','42501');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.expect_error('select public.bite_super_admin_overview_v1()','42501');
RESET ROLE;
-- India midnight, next-day, demo and POS exclusion cases.
INSERT INTO public.orders(id,restaurant_id,order_code,channel,status,is_demo,order_date) VALUES
 ('00000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-TODAY','Own Platform','Completed',false,timezone('Asia/Kolkata',now())::date::timestamp AT TIME ZONE 'Asia/Kolkata'),
 ('00000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-YESTERDAY','Own Platform','Completed',false,(timezone('Asia/Kolkata',now())::date::timestamp AT TIME ZONE 'Asia/Kolkata')-interval '1 second'),
 ('00000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-TOMORROW','Own Platform','Completed',false,(timezone('Asia/Kolkata',now())::date::timestamp AT TIME ZONE 'Asia/Kolkata')+interval '1 day'),
 ('00000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-DEMO','Own Platform','Completed',true,now()),
 ('00000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-POS','POS - Counter','Completed',false,now());
INSERT INTO public.order_financials(order_id,channel,is_demo,customer_payable_amount,commission_rate,commission_amount,payment_status) SELECT id,channel,is_demo,CASE WHEN order_code='QA-TODAY' THEN 170 ELSE 999 END,10,17,'paid' FROM public.orders;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((public.bite_super_admin_overview_v1()->>'orders_today')::int=1,'Today excludes prior/next India date, demo and POS');
SELECT pg_temp.assert_true((public.bite_super_admin_overview_v1()->>'collections_today')::numeric=170,'Collection amount is exact verified financial total');
RESET ROLE;
INSERT INTO public.orders(restaurant_id,order_code,channel,status,is_demo,order_date) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-DELAY-'||n,'Own Platform','Received',false,now()-interval '1 hour' FROM generate_series(1,32) n;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((public.bite_super_admin_overview_v1()->>'delayed_orders')::int=32,'All delayed orders counted beyond a single UI page');
SELECT pg_temp.assert_true(jsonb_array_length(public.bite_super_admin_attention_v1('delayed',0)->'rows')=25,'Attention list first page contains 25 records');
SELECT pg_temp.assert_true(jsonb_array_length(public.bite_super_admin_attention_v1('delayed',25)->'rows')=7,'Attention offset is applied exactly once');
SELECT pg_temp.assert_true((public.bite_super_admin_attention_v1('delayed',25)->>'total_count')::int=32,'Attention total stays exact on second page');
SELECT pg_temp.assert_true((public.bite_super_admin_attention_v1('unassigned',0)->>'total_count')::int=1,'Unassigned means no database Owner membership');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_attention_v1('delayed',-1)$q$,'P0001');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_attention_v1('owner_data',0)$q$,'P0001');
RESET ROLE;
-- Incomplete onboarding cannot be approved from any client.
SELECT pg_temp.expect_error($q$select public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','approve','',(select updated_at from public.restaurants where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))$q$,'P0001');
INSERT INTO public.menu_items(restaurant_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SELECT public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','approve','',(SELECT updated_at FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
SELECT pg_temp.assert_true((SELECT onboarding_status='approved' AND NOT is_published FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Approval does not silently publish a listing');
SELECT public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','publish','',(SELECT updated_at FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
SELECT pg_temp.assert_true((SELECT is_published FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Approved complete listing can be published');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pause','','2000-01-01')$q$,'40001');
SELECT pg_temp.expect_error($q$select public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','request_changes','x',(select updated_at from public.restaurants where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))$q$,'P0001');
SELECT public.bite_super_admin_review_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','request_changes','Update business address',(SELECT updated_at FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
SELECT pg_temp.assert_true((SELECT onboarding_status='rejected' AND NOT is_published AND onboarding_rejection_reason='Update business address' FROM public.restaurants WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Change request saves owner feedback and removes listing');
SELECT public.bite_super_admin_commission_v1(NULL,12.5,10);
SELECT public.bite_super_admin_commission_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',15,NULL);
SELECT public.bite_super_admin_commission_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,15);
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,99,10)','40001');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,101,12.5)','P0001');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,-1,12.5)','P0001');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,12.555,12.5)','P0001');
SELECT pg_temp.expect_error('select public.bite_super_admin_commission_v1(null,null,12.5)','P0001');
SELECT pg_temp.assert_true((SELECT bool_and(commission_rate=10 AND commission_amount=17) FROM public.order_financials),'Commission changes preserve all existing financial snapshots');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.platform_audit_logs WHERE action='commission_updated'),'Every commission save has an actor audit event');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.platform_audit_logs WHERE action LIKE 'restaurant_%'),'Restaurant approval/publish/change request are audited');
SELECT pg_temp.assert_true((SELECT count(*)=5 FROM public.order_financials),'Read/review actions never create new payments');
ROLLBACK;
