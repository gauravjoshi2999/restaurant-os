-- Trusted console only. Every synthetic record/configuration is rolled back.
-- No HTTP, message, Auth password change or payment-provider operation is used.
do $test$
declare p uuid;uid uuid;rid uuid;admin_id uuid;cfg jsonb;caps text[];r uuid;g uuid;s uuid;f uuid;t uuid;j uuid;o uuid;app uuid;p2 uuid;r2 uuid;g2 uuid;s2 uuid;f2 uuid;
 out jsonb;q jsonb;args jsonb;link jsonb;credit numeric;k uuid;before_orders text;before_menu text;before_hotel text;before_counts jsonb;
begin
 select md5(string_agg(id::text||':'||amount::text||':'||status,'|' order by id)) into before_orders from public.orders;
 select md5(string_agg(id::text||':'||name||':'||price::text,'|' order by id)) into before_menu from public.menu_items;
 select md5(coalesce(string_agg(v,'|' order by v),'')) into before_hotel from (
  select to_jsonb(x)::text v from public.bite_rooms x union all select to_jsonb(x)::text from public.bite_stays x union all select to_jsonb(x)::text from public.bite_guests x union all select to_jsonb(x)::text from public.bite_folios x union all select to_jsonb(x)::text from public.bite_folio_entries x) a;
 before_counts:=jsonb_build_object('payments',(select count(*) from public.restaurant_order_payments),'financials',(select count(*) from public.order_financials),'refund_jobs',(select count(*) from public.bite_refund_jobs),'restaurants',(select count(*) from public.restaurants));
 select pr.id,b.owner_id,pr.origin_restaurant_id,pr.capabilities,to_jsonb(pr) into strict p,uid,rid,caps,cfg
 from public.bite_properties pr join public.bite_businesses b on b.id=pr.business_id join public.restaurants re on re.id=pr.origin_restaurant_id
 where re.status='Active' and re.onboarding_status='approved' and not exists(select 1 from public.bite_property_shift_closings where property_id=pr.id and shift_date=current_date and locked)
 order by pr.created_at limit 1;
 select user_id into strict admin_id from public.platform_admins limit 1;
 begin
  perform set_config('request.jwt.claim.sub',uid::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
  caps:=array(select distinct unnest(caps||array['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals','restaurant_pos','restaurant_menu','room_service','charge_to_room','dine_in','takeaway','reporting']));
  perform public.bite_property_command(p,'config',jsonb_build_object('name',cfg->>'name','business_type','hybrid','capabilities',to_jsonb(caps),'tax_profile',cfg->'tax_profile'),gen_random_uuid());
  perform public.bite_property_command(p,'policy_save','{"checkin_time":"14:00","checkout_time":"11:00","policy":{"reviewed":true,"early_checkin_fee":0,"late_fee_per_hour":0,"unused_night_credit_percent":100}}',gen_random_uuid());
  out:=public.bite_property_command(p,'room_save',jsonb_build_object('number','QA-'||left(gen_random_uuid()::text,8),'room_type','Synthetic rollback only','nightly_rate',1,'adults',1,'children',0),gen_random_uuid());r:=(out->>'id')::uuid;
  out:=public.bite_property_command(p,'guest_save','{"full_name":"Synthetic remaining rollback guest","phone":"9999999999","country":"India","is_oci":true}',gen_random_uuid());g:=(out->>'id')::uuid;
  args:=jsonb_build_object('guest_id',g,'room_id',r,'arrival',current_date,'departure',current_date+4,'adults',1,'children',0,'advance_amount',4,'advance_method','Cash','booking_source','external_booking','booking_reference','SYNTHETIC-EXTERNAL','booking_mode','checkin');
  q:=public.bite_reservation_quote(p,args||'{"mode":"checkin"}'::jsonb);args:=args||jsonb_build_object('quote_hash',q->>'quote_hash');k:=gen_random_uuid();out:=public.bite_property_command(p,'reserve',args,k);assert public.bite_property_command(p,'reserve',args,k)=out;s:=(out->>'id')::uuid;f:=(out->>'folio_id')::uuid;
  assert (select count(*) from public.bite_folio_entries where folio_id=f and kind='advance')=1;
  perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
  perform public.bite_property_command(p,'room_privacy',jsonb_build_object('id',r,'do_not_disturb',false,'cleaning_requested',true),gen_random_uuid());
  select id into strict t from public.bite_service_tasks where property_id=p and room_id=r and kind='cleaning' and status='requested';
  perform public.bite_property_command(p,'task_update',jsonb_build_object('id',t,'status','in_progress'),gen_random_uuid());
  perform public.bite_property_command(p,'task_update',jsonb_build_object('id',t,'status','completed'),gen_random_uuid());
  assert (select housekeeping from public.bite_rooms where id=r)='cleaning';
  perform public.bite_property_command(p,'room_status',jsonb_build_object('id',r,'status','ready'),gen_random_uuid());
  out:=public.bite_property_command(p,'room_pos',jsonb_build_object('folio_id',f,'restaurant_id',rid,'fulfilment','room_service','items','[{"name":"Synthetic service rollback","quantity":1,"unit_price":0.1}]'::jsonb),gen_random_uuid());o:=(out->>'order_id')::uuid;
  select id into strict t from public.bite_service_tasks where order_id=o;
  assert (select count(*) from public.bite_folio_entries where source_order_id=o)=1;
  assert not exists(select 1 from public.restaurant_order_payments where order_id=o);
  perform public.bite_property_command(p,'task_update',jsonb_build_object('id',t,'status','in_progress'),gen_random_uuid());
  perform public.bite_property_command(p,'task_update',jsonb_build_object('id',t,'status','ready'),gen_random_uuid());
  perform public.bite_property_command(p,'task_update',jsonb_build_object('id',t,'status','completed'),gen_random_uuid());
  q:=public.bite_checkout_policy_quote(p,s);assert (q->>'early_credit')::numeric>=2;
  args:=jsonb_build_object('folio_id',f,'quote_hash',q->>'quote_hash');k:=gen_random_uuid();out:=public.bite_property_command(p,'apply_checkout_policy',args,k);assert public.bite_property_command(p,'apply_checkout_policy',args,k)=out;
  select -(value->'totals'->>'balance')::numeric into credit from jsonb_array_elements(public.bite_hotel_workspace(p)->'folios') where value->>'id'=f::text;assert credit>0;
  out:=public.bite_property_command(p,'refund_request',jsonb_build_object('folio_id',f,'amount',credit,'method','Cash','reason','Synthetic return record rollback only'),gen_random_uuid());j:=(out->>'id')::uuid;
  link:=public.bite_guest_link(p,f);out:=public.bite_guest_folio(link->>'token');assert out::text not like '%Synthetic remaining rollback guest%';
  assert out->'refunds'->0->>'status'='requested';
  args:=jsonb_build_object('id',j,'status','paid','return_verified',true,'reference','SYNTHETIC-RETURN-NO-MONEY');k:=gen_random_uuid();out:=public.bite_property_command(p,'refund_update',args,k);assert public.bite_property_command(p,'refund_update',args,k)=out;
  assert (select count(*) from public.bite_folio_entries where folio_id=f and kind='refund')=1;
  assert public.bite_guest_folio(link->>'token')->'refunds'->0->>'status'='paid';
  perform public.bite_property_command(p,'guest_link_revoke',jsonb_build_object('folio_id',f),gen_random_uuid());
  begin perform public.bite_guest_folio(link->>'token');raise exception using errcode='BT002',message='Guest revoke denial missing';exception when insufficient_privilege then null;end;
  perform public.bite_property_command(p,'compliance_save',jsonb_build_object('id',s,'arrival_reference','SYNTHETIC-NO-FILING'),gen_random_uuid());
  perform public.bite_property_command(p,'checkout',jsonb_build_object('folio_id',f),gen_random_uuid());
  assert (select count(*) from public.bite_service_tasks where property_id=p and room_id=r and stay_id is null and kind='cleaning' and status='requested')=1;
  assert jsonb_array_length(public.bite_unified_audit(p,'room_pos',null)->'rows')>0;
  -- Restaurant creator/owner and existing approval guards are real production code.
  p2:=public.bite_create_property('Synthetic application rollback only','hotel',gen_random_uuid());
  out:=public.bite_property_command(p2,'room_save',jsonb_build_object('number','QA-'||left(gen_random_uuid()::text,8),'room_type','Synthetic hotel before food','nightly_rate',1,'adults',1,'children',0),gen_random_uuid());r2:=(out->>'id')::uuid;
  out:=public.bite_property_command(p2,'guest_save','{"full_name":"Synthetic hotel adds food rollback","phone":"9999999999"}',gen_random_uuid());g2:=(out->>'id')::uuid;
  out:=public.bite_property_command(p2,'reserve',jsonb_build_object('guest_id',g2,'room_id',r2,'arrival',current_date,'departure',current_date+1,'adults',1,'children',0),gen_random_uuid());s2:=(out->>'id')::uuid;f2:=(out->>'folio_id')::uuid;
  perform public.bite_property_command(p2,'checkin',jsonb_build_object('id',s2),gen_random_uuid());
  perform public.bite_property_command(p2,'config',jsonb_build_object('name','Synthetic application rollback only','business_type','hybrid','capabilities',to_jsonb(caps)),gen_random_uuid());
  out:=public.bite_property_command(p2,'outlet_application','{"name":"Synthetic application rollback only","city":"Rajsamand","address":"Synthetic rollback address","phone":"9999999999"}',gen_random_uuid());app:=(out->>'id')::uuid;
  assert public.has_restaurant_role(app,array['owner']);
  assert not exists(select 1 from public.bite_property_outlets where restaurant_id=app);
  execute 'reset role';perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.restaurants set status='Active',onboarding_status='approved',onboarding_reviewed_at=now(),onboarding_reviewed_by=admin_id where id=app;
  assert exists(select 1 from public.bite_property_outlets where property_id=p2 and restaurant_id=app);
  assert not (select is_published from public.restaurants where id=app);
  assert (select stay_id from public.bite_folios where id=f2)=s2 and (select sum(amount)from public.bite_folio_entries where folio_id=f2 and kind='charge')=1;
  perform set_config('request.jwt.claim.sub',uid::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
  args:=jsonb_build_object('restaurant_id',app,'channel','POS - Counter','paid_amount',1,'payment_method','Cash','items','[{"name":"Synthetic closing rollback","quantity":1,"unit_price":1}]'::jsonb);
  perform public.bite_property_command(p2,'pos_sale',args,gen_random_uuid());
  q:=public.bite_property_report(p2,current_date,current_date);
  perform public.bite_property_command(p2,'close_shift',jsonb_build_object('shift_date',current_date,'opening_cash',100,'counted_cash',100+(q->>'cash_movement')::numeric,'source_hash',q->>'source_hash','lock_journals',true),gen_random_uuid());
  begin perform public.bite_property_command(p2,'pos_sale',args,gen_random_uuid());raise exception using errcode='BT002',message='Closed POS journal was not denied';exception when raise_exception then if position('locked' in sqlerrm)=0 then raise;end if;end;
  begin perform public.bite_property_command(p2,'charge',jsonb_build_object('folio_id',f2,'amount',1,'description','Synthetic closed hotel journal'),gen_random_uuid());raise exception using errcode='BT002',message='Closed hotel journal was not denied';exception when raise_exception then if position('locked' in sqlerrm)=0 then raise;end if;end;

  raise exception using errcode='BT001',message='EXPECTED_SYNTHETIC_ROLLBACK';
 exception when sqlstate 'BT001' then null;end;
 assert (select md5(string_agg(id::text||':'||amount::text||':'||status,'|' order by id)) from public.orders)=before_orders;
 assert (select md5(string_agg(id::text||':'||name||':'||price::text,'|' order by id)) from public.menu_items)=before_menu;
 assert (select md5(coalesce(string_agg(v,'|' order by v),'')) from (select to_jsonb(x)::text v from public.bite_rooms x union all select to_jsonb(x)::text from public.bite_stays x union all select to_jsonb(x)::text from public.bite_guests x union all select to_jsonb(x)::text from public.bite_folios x union all select to_jsonb(x)::text from public.bite_folio_entries x)a)=before_hotel;
 assert before_counts=jsonb_build_object('payments',(select count(*) from public.restaurant_order_payments),'financials',(select count(*) from public.order_financials),'refund_jobs',(select count(*) from public.bite_refund_jobs),'restaurants',(select count(*) from public.restaurants));
 perform set_config('bite.qa_result','PASS: real production POS/service, prepaid/policy credit, once-only return record, guest-link revoke/privacy, compliance acknowledgment, Hotel Only to Hybrid preserves its folio; creator/owner approval association; both hotel and real POS journals lock; all synthetic data rolled back; original order/menu/hotel digests and financial counts preserved',false);
end $test$;
select current_setting('bite.qa_result') verified_rollback_result;
