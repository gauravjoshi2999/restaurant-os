-- Disposable CI only. All synthetic transactions rolled back.
begin;
do $$begin
 if has_function_privilege('anon','public.bite_booking_with_deposit(uuid,text,jsonb,uuid)','EXECUTE') then raise exception 'Anonymous deposit RPC access';end if;
 if not has_function_privilege('authenticated','public.bite_booking_with_deposit(uuid,text,jsonb,uuid)','EXECUTE') then raise exception 'Missing authenticated RPC access';end if;
 if (select prosecdef from pg_proc where oid='public.bite_booking_with_deposit(uuid,text,jsonb,uuid)'::regprocedure) then raise exception 'Unexpected privilege elevation';end if;
end$$;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$
declare
 p uuid; g uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
 req uuid:=gen_random_uuid(); familyreq uuid:=gen_random_uuid(); payload jsonb; family jsonb; result jsonb; again jsonb; denied boolean; n integer; day date:=current_date+10;
begin
 p:=public.bite_create_property('Synthetic H10 Deposit Hotel','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic Deposit Guest","phone":"7777777701","country":"India","address":"Synthetic QA"}',gen_random_uuid())->>'id')::uuid;
 r1:=(public.bite_property_command(p,'room_save','{"number":"D101","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 r2:=(public.bite_property_command(p,'room_save','{"number":"D102","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 r3:=(public.bite_property_command(p,'room_save','{"number":"D103","room_type":"Deluxe","nightly_rate":1300,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 r4:=(public.bite_property_command(p,'room_save','{"number":"D104","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 r5:=(public.bite_property_command(p,'room_save','{"number":"D105","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 r6:=(public.bite_property_command(p,'room_save','{"number":"D106","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2}',gen_random_uuid())->>'id')::uuid;
 payload:=jsonb_build_object('guest_id',g,'room_id',r1,'arrival',day,'departure',day+1,'arrival_time','14:00','adults',1,'children',0,'nightly_rate',1200,'booking_mode','reserve','advance_amount',100,'advance_method','Cash','checkin_deposit',jsonb_build_object('amount',500,'method','Cash','verified',false));
 result:=public.bite_booking_with_deposit(p,'single',payload,req);
 again:=public.bite_booking_with_deposit(p,'single',payload,req);
 if result<>again then raise exception 'Single retry returned different result';end if;
 if (select count(*) from public.bite_stays where property_id=p)<>1 then raise exception 'Retry duplicated single reservation';end if;
 if (select count(*) from public.bite_folio_entries where property_id=p and kind='deposit_hold' and category='deposit' and amount=500 and tax_amount=0 and status='confirmed')<>1 then raise exception 'Cash deposit was lost, taxed or duplicated';end if;
 if (select sum(amount) from public.bite_folio_entries where property_id=p and kind='advance') is distinct from 100::numeric then raise exception 'Deposit contaminated advance';end if;
 denied:=false;begin perform public.bite_booking_with_deposit(p,'single',payload||jsonb_build_object('checkin_deposit',jsonb_build_object('amount',501,'method','Cash')),req);exception when others then denied:=true;end;
 if not denied then raise exception 'Changed amount accepted for same request';end if;
 family:=jsonb_build_object('name','Synthetic Deposit Family','guest_id',g,'mode','reserve','arrival',day,'departure',day+1,'arrival_time','14:00','advance_amount',0,'rooms',jsonb_build_array(jsonb_build_object('room_id',r2,'adults',1,'children',0,'nightly_rate',1200),jsonb_build_object('room_id',r3,'adults',1,'children',0,'nightly_rate',1300)),'checkin_deposit',jsonb_build_object('amount',700,'method','UPI','verified',false));
 result:=public.bite_booking_with_deposit(p,'family',family,familyreq);
 again:=public.bite_booking_with_deposit(p,'family',family,familyreq);
 if result<>again or jsonb_array_length(result->'stays')<>2 then raise exception 'Family retry/group incorrect';end if;
 if (select count(*) from public.bite_folio_entries where property_id=p and kind='deposit_hold' and amount=700 and status='pending' and tax_amount=0 and folio_id=(result->'stays'->0->>'folio_id')::uuid)<>1 then raise exception 'Unverified family deposit not a single pending lead-folio receipt';end if;
 if (select count(*) from public.bite_folio_entries where property_id=p and kind='deposit_hold')<>2 then raise exception 'Family deposit duplicated across rooms';end if;
 result:=public.bite_booking_with_deposit(p,'single',payload||jsonb_build_object('room_id',r4,'advance_amount',0,'checkin_deposit',jsonb_build_object('amount',300,'method','Card','verified',true,'reference','SYNTHETIC-CARD')),gen_random_uuid());
 if (select count(*) from public.bite_folio_entries where id=(result->>'deposit_entry_id')::uuid and status='confirmed' and kind='deposit_hold' and reference='SYNTHETIC-CARD')<>1 then raise exception 'Verified online deposit not confirmed';end if;
 denied:=false;begin perform public.bite_booking_with_deposit(p,'single',payload||jsonb_build_object('room_id',r5,'checkin_deposit',jsonb_build_object('amount',300,'method','UPI','verified',true)),gen_random_uuid());exception when others then denied:=true;end;
 if not denied then raise exception 'Online verification without reference accepted';end if;
 if exists(select 1 from public.bite_stays where property_id=p and room_id=r5) then raise exception 'Invalid deposit created a reservation';end if;
 perform public.bite_save_staff_access(p,'33333333-3333-4333-8333-333333333333','','manager',true,array['guest_entry','reservation_entry','checkin']);
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 denied:=false;begin perform public.bite_booking_with_deposit(p,'single',payload||jsonb_build_object('room_id',r6,'advance_amount',0),gen_random_uuid());exception when others then denied:=true;end;
 if not denied then raise exception 'Staff without payment permissions recorded deposit';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if exists(select 1 from public.bite_stays where property_id=p and room_id=r6) then raise exception 'Denied deposit left a partial reservation';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 denied:=false;begin perform public.bite_booking_with_deposit(p,'single',payload,req);exception when others then denied:=true;end;
 if not denied then raise exception 'Other property user replayed booking deposit';end if;
 raise notice 'PASS H10: single/family deposit once, exact retry, no tax or advance pollution, online pending/verified, denial rolls back booking';
end$$;
rollback;
