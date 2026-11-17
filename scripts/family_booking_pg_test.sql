-- Run only in disposable bite_hotel_ci after hotel_checkin_scenarios / hotel_bill_workflow.
-- Tests atomic groups, separate folios, per-room rates, retry and conflict rollback.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$
declare
 p uuid; lead_id uuid; r1 uuid; r2 uuid; r3 uuid;
 row jsonb; payload jsonb; result jsonb; again jsonb; request_id uuid:='83838383-8383-4383-8383-838383838383';
 current_day date; before_count integer; failed boolean;
 subject uuid; document_id uuid; front uuid; back uuid; lead_front uuid; lead_back uuid;
 doc_args jsonb; doc_result jsonb; family_ids jsonb:='[]'::jsonb; reg1 jsonb; reg2 jsonb;
 i integer; j integer;
begin
 select id into strict p from public.bite_properties where name='Synthetic Hotel' limit 1;
 current_day:=(now() at time zone 'Asia/Kolkata')::date;
 row:=public.bite_property_command(p,'room_save','{"number":"FAMILY-101","room_type":"Deluxe","nightly_rate":1200,"adults":2,"children":2,"active":true}',gen_random_uuid());
 r1:=(row->>'id')::uuid;
 row:=public.bite_property_command(p,'room_save','{"number":"FAMILY-102","room_type":"Deluxe","nightly_rate":1300,"adults":2,"children":2,"active":true}',gen_random_uuid());
 r2:=(row->>'id')::uuid;
 row:=public.bite_property_command(p,'room_save','{"number":"FAMILY-103","room_type":"Deluxe","nightly_rate":1400,"adults":2,"children":2,"active":true}',gen_random_uuid());
 r3:=(row->>'id')::uuid;
 row:=public.bite_property_command(p,'guest_save','{"full_name":"Synthetic Family Lead","phone":"8888888880","address":"Synthetic verified address","country":"India"}',gen_random_uuid());
 lead_id:=(row->>'id')::uuid;
 -- Synthetic protected ID documents for one lead and three adult companions.
 -- The same secure guest-document commands used by Check-in must be honored.
 for i in 0..3 loop
  subject:=case when i=0 then null else gen_random_uuid() end;
  front:=null;back:=null;
  for j in 0..1 loop
   document_id:=gen_random_uuid();
   doc_args:='{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}'::jsonb;
   if subject is not null then doc_args:=doc_args||jsonb_build_object('subject_key',subject);end if;
   doc_result:=public.bite_guest_document_command(p,lead_id,document_id,'begin',doc_args);
   perform set_config('storage.operation','object.upload',true);
   insert into storage.objects(bucket_id,name,metadata,owner_id)
   values('bite-guest-documents',doc_result->>'object_path','{"size":8,"mimetype":"image/png"}',auth.uid()::text);
   perform public.bite_guest_document_command(p,lead_id,document_id,'finish');
   if j=0 then front:=document_id;else back:=document_id;end if;
  end loop;
  if i=0 then lead_front:=front;lead_back:=back;
  else family_ids:=family_ids||jsonb_build_array(jsonb_build_object('subject_key',subject,'name','Family adult '||i,'id_front',front,'id_back',back));
  end if;
 end loop;
 reg1:=jsonb_build_object('male',1,'female',1,'children',0,'arrived_from','Udaipur','next_destination','Jaipur','transport','Bus',
  'id_front',lead_front,'id_back',lead_back,'additional_ids',jsonb_build_array(family_ids->0),
  'family_guest_ids',family_ids,'guest_snapshot',jsonb_build_object('full_name','Synthetic Family Lead','address','Synthetic verified address'));
 reg2:=(reg1-'family_guest_ids')||jsonb_build_object('additional_ids',jsonb_build_array(family_ids->1));
 payload:=jsonb_build_object(
  'name','Synthetic family booking','guest_id',lead_id,'mode','checkin',
  'arrival',current_day,'departure',current_day+1,'arrival_time','14:00',
  'rooms',jsonb_build_array(
   jsonb_build_object('room_id',r1,'adults',2,'children',0,'nightly_rate',1200,'registration',reg1),
   jsonb_build_object('room_id',r2,'adults',2,'children',1,'nightly_rate',1300,'registration',reg2)
  )
 );
 -- Direct API callers cannot bypass protected photo registration.
 failed:=false;
 begin
  perform public.bite_family_booking(p,payload||jsonb_build_object('rooms',
   jsonb_build_array(jsonb_build_object('room_id',r1,'adults',2,'children',0,'nightly_rate',1200),
                     jsonb_build_object('room_id',r2,'adults',2,'children',0,'nightly_rate',1300))),gen_random_uuid());
 exception when others then failed:=true;
 end;
 if not failed then raise exception 'Family registration photo bypass was accepted';end if;
 result:=public.bite_family_booking(p,payload,request_id);
 if jsonb_array_length(result->'stays')<>2 then raise exception 'Family booking did not allocate both rooms';end if;
 if (select count(*) from public.bite_stays where group_id=(result->>'id')::uuid and status='in_house')<>2 then raise exception 'Both rooms must be checked in atomically';end if;
 if (select count(*) from public.bite_folios f join public.bite_stays s on s.id=f.stay_id where s.group_id=(result->>'id')::uuid)<>2 then raise exception 'Missing separate family folios';end if;
 if (select sum(nightly_rate) from public.bite_stays where group_id=(result->>'id')::uuid)<>2500 then raise exception 'Per-room agreed rates not honored';end if;
 if (select count(*) from public.bite_folio_entries e join public.bite_folios f on f.id=e.folio_id join public.bite_stays s on s.id=f.stay_id where s.group_id=(result->>'id')::uuid and e.category='room' and e.status='confirmed')<>2 then raise exception 'Room charge was duplicated or missing';end if;
 again:=public.bite_family_booking(p,payload,request_id);
 if again<>result then raise exception 'Stable retry did not return original booking';end if;
 if (select count(*) from public.bite_stays where group_id=(result->>'id')::uuid)<>2 then raise exception 'Retry created extra stays';end if;
 -- One occupied room makes the entire NEW group fail, leaving free rooms untouched.
 before_count:=(select count(*) from public.bite_stays where room_id=r3);
 failed:=false;
 begin
  perform public.bite_family_booking(p,payload||jsonb_build_object('rooms',
    jsonb_build_array(jsonb_build_object('room_id',r3,'adults',1,'children',0,'nightly_rate',1400,'registration',reg1||jsonb_build_object('male',1,'female',0,'additional_ids','[]'::jsonb)),
                      jsonb_build_object('room_id',r1,'adults',1,'children',0,'nightly_rate',1200,'registration',reg2||jsonb_build_object('male',1,'female',0,'additional_ids','[]'::jsonb)))),gen_random_uuid());
 exception when others then failed:=true;
 end;
 if not failed or (select count(*) from public.bite_stays where room_id=r3)<>before_count then
  raise exception 'Conflicting booking did not roll back all rooms';
 end if;
 -- A token reused for altered rooms must not authorize a second booking.
 failed:=false;
 begin
  perform public.bite_family_booking(p,payload||jsonb_build_object('name','Changed family'),request_id);
 exception when others then failed:=true;
 end;
 if not failed then raise exception 'Changed-payload retry was allowed';end if;
 -- Different tenant owner cannot allocate against this property.
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;
 begin
  perform public.bite_family_booking(p,payload,gen_random_uuid());
 exception when others then failed:=true;
 end;
 if not failed then raise exception 'Cross-property family booking was allowed';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 raise notice 'PASS: family group atomic rooms, linked folios, rates, retries and property isolation';
end $$;
rollback;
