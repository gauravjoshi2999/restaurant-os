begin;
create function pg_temp.denied(statement text) returns void language plpgsql as $$begin
 begin execute statement;raise exception 'EXPECTED_LOCK_DENIAL_MISSING';exception when raise_exception then
  if sqlerrm='EXPECTED_LOCK_DENIAL_MISSING' or position('locked' in sqlerrm)=0 then raise;end if;
 end;end $$;
do $$declare p uuid;r uuid;g uuid;s uuid;f uuid;ord uuid;v jsonb;q jsonb;a jsonb;k uuid;rid uuid:='eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea';begin
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 p:=public.bite_create_property('Combined locking synthetic','hybrid',gen_random_uuid());
 insert into public.restaurants(id,name,created_by,status,onboarding_status)values(rid,'Combined test outlet','66666666-6666-4666-8666-666666666666','Active','approved');
 insert into public.bite_property_outlets values(p,rid);insert into public.restaurant_members values(rid,'11111111-1111-4111-8111-111111111111','owner');
 v:=public.bite_property_command(p,'room_save','{"number":"Lock-1","room_type":"Deluxe","nightly_rate":100,"adults":2,"children":1}',gen_random_uuid());r:=(v->>'id')::uuid;
 v:=public.bite_property_command(p,'guest_save','{"full_name":"Closing synthetic guest","phone":"9999999900"}',gen_random_uuid());g:=(v->>'id')::uuid;
 v:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',current_date,'departure',current_date+1,'adults',1,'children',0),gen_random_uuid());s:=(v->>'id')::uuid;f:=(v->>'folio_id')::uuid;
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
 -- A review-only snapshot must preserve legacy entry behavior.
 q:=public.bite_property_report(p,current_date,current_date);
 perform public.bite_property_command(p,'close_shift',jsonb_build_object('shift_date',current_date,'opening_cash',1000,'counted_cash',1000,'source_hash',q->>'source_hash'),gen_random_uuid());
 insert into public.restaurant_expenses(restaurant_id,expense_date,amount,payment_method)values(rid,current_date,1,'Cash');
 perform public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f,'amount',100,'method','Cash','description','Recorded hotel cash'),gen_random_uuid());
 q:=public.bite_property_report(p,current_date,current_date);
 a:=jsonb_build_object('shift_date',current_date,'opening_cash',1000,'counted_cash',1099,'source_hash',q->>'source_hash','lock_journals',true);k:=gen_random_uuid();v:=public.bite_property_command(p,'close_shift',a,k);
 assert v=public.bite_property_command(p,'close_shift',a,k);
 assert (select locked and snapshot->>'source_hash'<>lock_review->>'source_hash' from public.bite_property_shift_closings where property_id=p);
 perform pg_temp.denied(format('insert into public.restaurant_expenses(restaurant_id,expense_date,amount)values(%L,current_date,1)',rid));
 perform pg_temp.denied(format('update public.restaurant_expenses set amount=2 where restaurant_id=%L',rid));
 perform pg_temp.denied(format('delete from public.restaurant_expenses where restaurant_id=%L',rid));
 perform pg_temp.denied(format('insert into public.restaurant_purchases(restaurant_id,purchase_date,paid_amount)values(%L,current_date,1)',rid));
 perform pg_temp.denied(format('insert into public.restaurant_cashbook_manual_entries(restaurant_id,entry_date,amount,direction)values(%L,current_date,1,''in'')',rid));
 perform pg_temp.denied(format('insert into public.restaurant_employee_payments(restaurant_id,payment_date,amount)values(%L,current_date,1)',rid));
 perform pg_temp.denied(format('insert into public.restaurant_customer_ledger_entries(restaurant_id,entry_date,entry_type,amount)values(%L,current_date,''credit'',1)',rid));
 perform pg_temp.denied(format('insert into public.orders(restaurant_id,channel,amount)values(%L,''POS - Counter'',1)',rid));
 perform pg_temp.denied(format('insert into public.restaurant_order_refunds(restaurant_id,refund_date,refund_amount)values(%L,current_date,1)',rid));
 perform pg_temp.denied(format('insert into public.restaurant_order_payments(restaurant_id,payment_date,amount)values(%L,current_date,1)',rid));
 perform pg_temp.denied(format('select public.bite_property_command(%L,''charge'',%L,gen_random_uuid())',p,jsonb_build_object('folio_id',f,'amount',1,'description','After closing')::text));
 perform pg_temp.denied(format('select public.bite_property_command(%L,''expense'',%L,gen_random_uuid())',p,jsonb_build_object('amount',1,'expense_date',current_date,'description','After closing','method','Cash')::text));
 -- A later open-day correction is possible; paid marketplace activation is untouched.
 insert into public.restaurant_expenses(restaurant_id,expense_date,amount)values(rid,current_date+1,1);
 insert into public.orders(restaurant_id,channel,amount,status)values(rid,'Own Platform',1,'Received')returning id into ord;
 update public.orders set status='Accepted' where id=ord;
 assert (select status from public.orders where id=ord)='Accepted';
 raise notice 'PASS: snapshot compatibility, lock upgrade keeps original snapshot, seven cashbook sources, hotel journal guards, later-day correction and marketplace activation';
end $$;
rollback;
