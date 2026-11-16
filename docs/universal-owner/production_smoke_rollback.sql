-- Trusted SQL-console verification ONLY. All synthetic rows and module changes
-- are deliberately rolled back inside a subtransaction. No provider calls.
-- Existing order triggers were inspected: push/refund queues are Own Platform
-- only and this test uses POS. No live charge, refund or transfer is initiated.
do $test$
declare
 p uuid;uid uuid;rid uuid;property_name text;capabilities text[];r uuid;g uuid;s uuid;f uuid;o uuid;k uuid;
 result jsonb;invoice jsonb;before_orders text;before_menu text;before_payments bigint;before_financials bigint;
begin
 select md5(string_agg(id::text||':'||amount::text||':'||status,'|' order by id)) into before_orders from public.orders;
 select md5(string_agg(id::text||':'||name||':'||price::text,'|' order by id)) into before_menu from public.menu_items;
 select count(*) into before_payments from public.restaurant_order_payments;
 select count(*) into before_financials from public.order_financials;
 select pr.id,b.owner_id,pr.origin_restaurant_id,pr.name,pr.capabilities
 into strict p,uid,rid,property_name,capabilities
 from public.bite_properties pr join public.bite_businesses b on b.id=pr.business_id
 join public.restaurants re on re.id=pr.origin_restaurant_id
 where re.status='Active' and re.onboarding_status='approved'
 order by (lower(pr.name) like '%qa%' or lower(pr.name) like '%test%' or lower(pr.name) like '%demo%') desc,pr.created_at
 limit 1;
 begin
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  assert auth.uid()=uid;
  assert jsonb_array_length(public.bite_owner_context())>=1;
  capabilities:=array(select distinct unnest(capabilities||array['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals','restaurant_pos','restaurant_menu','room_service','charge_to_room']));
  perform public.bite_property_command(p,'config',jsonb_build_object('name',property_name,'business_type','hybrid','capabilities',to_jsonb(capabilities),'tax_profile','{"reviewed":false}'::jsonb),gen_random_uuid());
  result:=public.bite_property_command(p,'room_save',jsonb_build_object('number','QA-'||left(gen_random_uuid()::text,8),'room_type','Rollback verification','nightly_rate',1,'adults',1,'children',0),gen_random_uuid());r:=(result->>'id')::uuid;
  result:=public.bite_property_command(p,'guest_save','{"full_name":"Synthetic rollback verification","phone":"9999999999","country":"India"}',gen_random_uuid());g:=(result->>'id')::uuid;
  result:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',current_date,'departure',current_date+1,'adults',1,'children',0),gen_random_uuid());s:=(result->>'id')::uuid;f:=(result->>'folio_id')::uuid;
  perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
  perform public.bite_property_command(p,'charge',jsonb_build_object('folio_id',f,'amount',3,'description','Synthetic laundry, rollback only'),gen_random_uuid());
  result:=public.bite_property_command(p,'room_pos',jsonb_build_object('folio_id',f,'restaurant_id',rid,'items','[{"name":"Synthetic POS rollback item","quantity":1,"unit_price":2}]'::jsonb),gen_random_uuid());o:=(result->>'order_id')::uuid;
  assert (select count(*) from public.order_items where order_id=o)=1;
  assert (select count(*) from public.bite_folio_entries where source_order_id=o)=1;
  assert not exists(select 1 from public.restaurant_order_payments where order_id=o);
  begin
   insert into public.restaurant_order_payments(order_id,restaurant_id,amount,payment_method,payment_date,created_by)
   values(o,rid,2,'Cash',current_date,uid);
   raise exception using errcode='BT002',message='POS duplicate collection was not denied';
  exception when raise_exception then null;
  end;
  assert not exists(select 1 from public.restaurant_order_payments where order_id=o);
  perform public.bite_property_command(p,'deposit_hold',jsonb_build_object('folio_id',f,'amount',10,'description','Synthetic deposit, rollback only','method','Cash'),gen_random_uuid());
  perform public.bite_property_command(p,'deposit_return',jsonb_build_object('folio_id',f,'amount',10,'description','Synthetic returned deposit, rollback only','method','Cash'),gen_random_uuid());
  k:=gen_random_uuid();
  result:=public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f,'amount',6,'description','Synthetic collection record, rollback only','method','Cash'),k);
  assert public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f,'amount',6,'description','Synthetic collection record, rollback only','method','Cash'),k)=result;
  assert (select count(*) from public.bite_folio_entries where folio_id=f and kind='payment')=1;
  result:=public.bite_property_command(p,'checkout',jsonb_build_object('folio_id',f),gen_random_uuid());invoice:=result->'invoice';
  assert (invoice->'totals'->>'charges')::numeric=6;
  assert (invoice->'totals'->>'paid')::numeric=6;
  assert (invoice->'totals'->>'balance')::numeric=0;
  assert (select housekeeping from public.bite_rooms where id=r)='dirty';
  result:=public.bite_property_command(p,'checkout',jsonb_build_object('folio_id',f),gen_random_uuid());
  assert (result->>'already_complete')::boolean and result->'invoice'=invoice;
  assert not exists(select 1 from public.restaurant_order_payments where order_id=o);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not exists(select 1 from public.bite_guests where id=g);
  begin
   perform public.bite_hotel_workspace(p);
   raise exception using errcode='BT002',message='Cross-tenant RPC was not denied';
  exception when insufficient_privilege then null;
  end;
  assert not has_function_privilege('anon','public.bite_property_command(uuid,text,jsonb,uuid)','execute');
  raise exception using errcode='BT001',message='EXPECTED_SYNTHETIC_ROLLBACK';
 exception when sqlstate 'BT001' then null;
 end;
 assert (select md5(string_agg(id::text||':'||amount::text||':'||status,'|' order by id)) from public.orders)=before_orders;
 assert (select md5(string_agg(id::text||':'||name||':'||price::text,'|' order by id)) from public.menu_items)=before_menu;
 assert (select count(*) from public.restaurant_order_payments)=before_payments;
 assert (select count(*) from public.order_financials)=before_financials;
 assert not exists(select 1 from public.bite_guests where full_name='Synthetic rollback verification');
 perform set_config('bite.qa_result','PASS: authenticated RPCs and existing POS engine; room + food + incidental checkout; duplicate collection blocked; payment/checkout retries; invoice and Dirty room; cross-tenant RLS/RPC and anonymous denial; synthetic rows rolled back; original digests and financial counts preserved',false);
end $test$;
select current_setting('bite.qa_result') as verified_rollback_result;
