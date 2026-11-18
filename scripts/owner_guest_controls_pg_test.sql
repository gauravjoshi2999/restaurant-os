-- Full permission, family ID, advance and owner-removal scenarios in disposable CI only.
begin;
create temp table controls_state(k text primary key,v text);
grant all on controls_state to authenticated;
create function pg_temp.denied(q text) returns void language plpgsql as $$begin
 begin execute q;exception when others then return;end;
 raise exception 'Expected denial: %',q;
end$$;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$
declare p uuid;r1 uuid;r2 uuid;r3 uuid;r4 uuid;g uuid;subject uuid;d uuid;front uuid;back uuid;lead_front uuid;lead_back uuid;v jsonb;party jsonb:='[]';reg jsonb;payload jsonb;result jsonb;request uuid:=gen_random_uuid();day date:=(now() at time zone 'Asia/Kolkata')::date;i integer;j integer;begin
 p:=public.bite_create_property('Synthetic Controls Hotel','hotel',gen_random_uuid());
 r1:=(public.bite_property_command(p,'room_save','{"number":"C101","room_type":"Deluxe","nightly_rate":1200,"adults":4,"children":2}',gen_random_uuid())->>'id')::uuid;
 r2:=(public.bite_property_command(p,'room_save','{"number":"C102","room_type":"Deluxe","nightly_rate":1300,"adults":4,"children":2}',gen_random_uuid())->>'id')::uuid;
 r3:=(public.bite_property_command(p,'room_save','{"number":"C103","room_type":"Deluxe","nightly_rate":1500,"adults":4,"children":2}',gen_random_uuid())->>'id')::uuid;
 r4:=(public.bite_property_command(p,'room_save','{"number":"C104","room_type":"Deluxe","nightly_rate":1500,"adults":4,"children":2}',gen_random_uuid())->>'id')::uuid;
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic Controls Lead","phone":"7777777770","address":"Synthetic QA address","country":"India"}',gen_random_uuid())->>'id')::uuid;
 for i in 0..2 loop
  subject:=case when i=0 then null else gen_random_uuid() end;
  for j in 0..1 loop
   d:=gen_random_uuid();
   v:=public.bite_guest_document_command(p,g,d,'begin',jsonb_build_object('kind','masked_id','mime_type','image/png','byte_size',8,'redacted_confirmed',true)||case when subject is null then '{}'::jsonb else jsonb_build_object('subject_key',subject)end);
   perform set_config('storage.operation','object.upload',true);
   insert into storage.objects(bucket_id,name,metadata,owner_id) values('bite-guest-documents',v->>'object_path','{"size":8,"mimetype":"image/png"}',auth.uid()::text);
   perform public.bite_guest_document_command(p,g,d,'finish');
   if j=0 then front:=d;else back:=d;end if;
  end loop;
  if i=0 then lead_front:=front;lead_back:=back;else party:=party||jsonb_build_array(jsonb_build_object('subject_key',subject,'name','Companion '||i,'id_front',front,'id_back',back));end if;
 end loop;
 reg:=jsonb_build_object('male',1,'female',1,'children',0,'id_front',lead_front,'id_back',lead_back,'arrived_from','Udaipur','next_destination','Jaipur','transport','Bus','guest_snapshot',jsonb_build_object('full_name','Synthetic Controls Lead','address','Synthetic QA address'),'additional_ids',jsonb_build_array(party->0),'family_guest_ids',jsonb_build_array(party->0));
 payload:=jsonb_build_object('name','Two ID Family','guest_id',g,'mode','checkin','arrival',day,'departure',day+1,'arrival_time','14:00','advance_amount',2000,'advance_method','Cash',
 'rooms',jsonb_build_array(jsonb_build_object('room_id',r1,'adults',2,'children',0,'nightly_rate',1200,'registration',reg),jsonb_build_object('room_id',r2,'adults',2,'children',0,'nightly_rate',1300,'registration',(reg-'family_guest_ids')||jsonb_build_object('additional_ids','[]'::jsonb))));
 -- Four adults, two rooms, only TWO complete ID records. One lead + one companion.
 result:=public.bite_family_booking(p,payload,request);
 if (select count(*) from public.bite_stays where group_id=(result->>'id')::uuid and status='in_house')<>2 then raise exception '2 IDs did not check in all family rooms';end if;
 if (select sum(e.amount) from public.bite_folio_entries e where property_id=p and kind='advance')<>2000 then raise exception 'Group advance was lost or duplicated';end if;
 if public.bite_family_booking(p,payload,request)<>result then raise exception 'Family retry was not idempotent';end if;
 if (select sum(e.amount) from public.bite_folio_entries e where property_id=p and kind='advance')<>2000 then raise exception 'Retry duplicated advance';end if;
 -- The optional third ID must also be accepted; one ID alone remains insufficient.
 reg:=reg||jsonb_build_object('additional_ids',party,'family_guest_ids',party,'male',3,'female',0);
 payload:=payload||jsonb_build_object('advance_amount',0,'rooms',jsonb_build_array(jsonb_build_object('room_id',r3,'adults',3,'children',0,'nightly_rate',1500,'registration',reg),jsonb_build_object('room_id',r4,'adults',1,'children',0,'nightly_rate',1500,'registration',(reg-'family_guest_ids')||jsonb_build_object('male',1,'additional_ids','[]'::jsonb))));
 perform pg_temp.denied(format('select public.bite_family_booking(%L,%L,gen_random_uuid())',p,(payload||jsonb_build_object('rooms',jsonb_build_array((payload->'rooms'->0)||jsonb_build_object('registration',reg||jsonb_build_object('family_guest_ids','[]'::jsonb)),payload->'rooms'->1)))::text));
 perform public.bite_family_booking(p,payload,gen_random_uuid());
 perform public.bite_save_staff_access(p,'33333333-3333-4333-8333-333333333333','', 'manager',true, array['guest_entry','reservation_entry','checkin']);
 insert into controls_state values('p',p),('g',g),('r1',r1),('family_request',request),('family_payload',payload::text),('front',lead_front);
 raise notice 'PASS: 4 adults / 2 rooms / 2 IDs, optional 3rd ID, exact 2000 cash advance and stable retry';
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare p uuid;v jsonb;begin
 select s.v::uuid into p from controls_state s where k='p';
 if not private.bite_can(p,'guest_register') or private.bite_can(p,'reporting') then raise exception 'Entry-only manager permissions are incorrect';end if;
 v:=public.bite_owner_context();
 if v->0->>'can_delete_data'<>'false' or (v->0->'capabilities')?'reporting' then raise exception 'Staff context advertised owner permissions';end if;
 perform public.bite_property_command(p,'guest_save','{"full_name":"Staff entered guest","phone":"6666666660","country":"India"}',gen_random_uuid());
 perform pg_temp.denied(format('select public.bite_property_command(%L,''payment'',%L,gen_random_uuid())',p,'{"amount":10}'));
 perform pg_temp.denied(format('select public.bite_property_command(%L,''checkout'',%L,gen_random_uuid())',p,'{}'));
 perform pg_temp.denied(format('select public.bite_property_command(%L,''config'',%L,gen_random_uuid())',p,'{}'));
 perform pg_temp.denied(format('select private.bite_property_command_before_staff_permissions(%L,''payment'',''{}'',gen_random_uuid())',p));
 perform pg_temp.denied(format('select public.bite_daily_book(%L,current_date,current_date)',p));
 perform pg_temp.denied(format('select public.bite_owner_data_preview(%L,''stays'',''{}'')',p));
 perform pg_temp.denied(format('select public.bite_save_staff_access(%L,null,''x@example.test'',''manager'',true,array[''reporting''])',p));
 perform pg_temp.denied('select * from private.bite_owner_deleted_data');
 raise notice 'PASS: manager can enter guests, cannot pay/checkout/delete/configure, cannot call preserved private command or grant own access';
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.denied(format('select public.bite_owner_data_preview(%L,''stays'',''{}'')',(select v from controls_state where k='p')));
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$declare p uuid;begin
 select s.v::uuid into p from controls_state s where k='p';
 perform public.bite_save_staff_access(p,'33333333-3333-4333-8333-333333333333','','manager',true,array['guest_entry','reservation_entry','checkin','reporting','checkout','payment_entry','payment_verify']);
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare p uuid;begin
 select s.v::uuid into p from controls_state s where k='p';
 if not private.bite_can(p,'reporting') or not private.bite_staff_can(p,'checkout') then raise exception 'Explicit owner grant was not applied';end if;
 perform public.bite_daily_book(p,current_date,current_date);
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$declare p uuid;v jsonb;r jsonb;request uuid:=gen_random_uuid();begin
 select s.v::uuid into p from controls_state s where k='p';
 perform public.bite_save_staff_access(p,'33333333-3333-4333-8333-333333333333','','manager',false,'{}');
 perform pg_temp.denied(format('select public.bite_owner_data_preview(%L,''invalid_scope'',''{}'')',p));
 v:=public.bite_owner_data_preview(p,'stays','{}');
 if (v->>'count')::integer<>4 then raise exception 'Removal preview count wrong';end if;
 perform pg_temp.denied(format('select public.bite_owner_data_delete(%L,''stays'',''{}'',''stale-hash'',''Synthetic Controls Hotel'',gen_random_uuid())',p));
 perform pg_temp.denied(format('select public.bite_owner_data_delete(%L,''stays'',''{}'',%L,''wrong hotel'',gen_random_uuid())',p,v->>'preview_hash'));
 r:=public.bite_owner_data_delete(p,'stays','{}',v->>'preview_hash','Synthetic Controls Hotel',request);
 if (r->>'deleted')::integer<>4 then raise exception 'Owner removal did not delete selected stays';end if;
 if exists(select 1 from public.bite_stays where property_id=p) or exists(select 1 from public.bite_folios where property_id=p) or exists(select 1 from public.bite_folio_entries where property_id=p) then raise exception 'Hotel reset left bills or ledger rows on dashboard';end if;
 r:=public.bite_owner_data_delete(p,'stays','{}',v->>'preview_hash','Synthetic Controls Hotel',request);
 if r->>'already_complete'<>'true' then raise exception 'Removal retry was not idempotent';end if;
 v:=public.bite_owner_data_preview(p,'guests','{}');
 perform public.bite_owner_data_delete(p,'guests','{}',v->>'preview_hash','Synthetic Controls Hotel',gen_random_uuid());
 if exists(select 1 from public.bite_guests where property_id=p) or exists(select 1 from public.bite_guest_documents where property_id=p) then raise exception 'Deleted guest profile or ID reference is still exposed';end if;
 v:=public.bite_owner_data_preview(p,'rooms','{}');
 perform public.bite_owner_data_delete(p,'rooms','{}',v->>'preview_hash','Synthetic Controls Hotel',gen_random_uuid());
 if exists(select 1 from public.bite_rooms where property_id=p) then raise exception 'Room setup removal failed';end if;
 raise notice 'PASS: owner grants/revokes permissions, previews exact data, blocks stale preview/wrong confirmation, removes dependent stays/bills then guests/IDs and rooms without affecting another tenant';
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.denied(format('select public.bite_hotel_workspace(%L)',(select v from controls_state where k='p')));
rollback;
