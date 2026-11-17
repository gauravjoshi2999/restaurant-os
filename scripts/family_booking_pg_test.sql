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
 payload:=jsonb_build_object(
  'name','Synthetic family booking','guest_id',lead_id,'mode','checkin',
  'arrival',current_day,'departure',current_day+1,'arrival_time','14:00',
  'rooms',jsonb_build_array(
   jsonb_build_object('room_id',r1,'adults',2,'children',0,'nightly_rate',1200),
   jsonb_build_object('room_id',r2,'adults',2,'children',1,'nightly_rate',1300)
  )
 );
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
    jsonb_build_array(jsonb_build_object('room_id',r3,'adults',1,'children',0,'nightly_rate',1400),
                      jsonb_build_object('room_id',r1,'adults',1,'children',0,'nightly_rate',1200))),gen_random_uuid());
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
