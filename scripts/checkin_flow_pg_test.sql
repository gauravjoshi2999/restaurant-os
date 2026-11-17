-- Synthetic hotel/register workflow. No production records; the entire test rolls back.
begin;
create temp table checkin_flow_state(k text primary key,v text);
grant all on checkin_flow_state to authenticated;
create function pg_temp.checkin_flow_denied(q text)returns void language plpgsql as $$begin
 begin execute q;exception when sqlstate '42501'or sqlstate '22023'or sqlstate 'P0001'then return;end;
 raise exception 'Expected check-in denial: %',q;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$declare p uuid;r uuid;legacy uuid;g uuid;subject uuid;d uuid;v jsonb;args jsonb;ids jsonb:='[]';person jsonb;front uuid;back uuid;i integer;j integer;begin
 p:=public.bite_create_property('Synthetic per-stay terms','hotel',gen_random_uuid());
 r:=(public.bite_property_command(p,'room_save','{"number":"104","room_type":"Deluxe","floor":"1"}',gen_random_uuid())->>'id')::uuid;
 if exists(select 1 from public.bite_rooms where id=r and(nightly_rate is not null or adults is not null or children is not null))then raise exception 'New room must not require preset rent or occupancy';end if;
 perform public.bite_property_command(p,'room_save',jsonb_build_object('id',r,'number','104','room_type','Deluxe','floor','2','active',true),gen_random_uuid());
 if (select floor from public.bite_rooms where id=r)<>'2'then raise exception 'Room edit without financial defaults failed';end if;
 legacy:=(public.bite_property_command(p,'room_save','{"number":"105","room_type":"Legacy","nightly_rate":1500,"adults":1,"children":0}',gen_random_uuid())->>'id')::uuid;
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic party lead","phone":"9999999999","address":"Synthetic address"}',gen_random_uuid())->>'id')::uuid;
 perform public.bite_property_command(p,'member','{"id":"33333333-3333-4333-8333-333333333333","role":"receptionist","active":true}',gen_random_uuid());
 -- Six copies for three named people, each with its own serialized per-person quota.
 for i in 0..2 loop
  subject:=case when i=0 then null else gen_random_uuid()end;front:=null;back:=null;
  for j in 0..1 loop
   d:=gen_random_uuid();args:='{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}'::jsonb;
   if subject is not null then args:=args||jsonb_build_object('subject_key',subject);end if;
   v:=public.bite_guest_document_command(p,g,d,'begin',args);
   if public.bite_guest_document_command(p,g,d,'begin',args)<>v then raise exception 'Party ID retry duplicated an upload';end if;
   perform set_config('storage.operation','object.upload',true);
   insert into storage.objects(bucket_id,name,metadata,owner_id)values('bite-guest-documents',v->>'object_path','{"size":8,"mimetype":"image/png"}',auth.uid()::text);
   perform public.bite_guest_document_command(p,g,d,'finish');
   if j=0 then front:=d;else back:=d;end if;
  end loop;
  if i=0 then insert into checkin_flow_state values('front',front),('back',back);
  else ids:=ids||jsonb_build_array(jsonb_build_object('subject_key',subject,'name','Synthetic companion '||i,'id_front',front,'id_back',back));end if;
 end loop;
 if jsonb_array_length(public.bite_guest_document_list(p,g))<>6 then raise exception 'Three guest IDs need six retained sides';end if;
 insert into checkin_flow_state values('p',p),('r',r),('legacy',legacy),('g',g),('ids',ids::text);
end$$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare p uuid;r uuid;legacy uuid;g uuid;s uuid;v jsonb;details jsonb;args jsonb;reg jsonb;party jsonb;front uuid;d date:=(now()at time zone'Asia/Kolkata')::date;begin
 select st.v::uuid into p from checkin_flow_state st where k='p';select st.v::uuid into r from checkin_flow_state st where k='r';select st.v::uuid into legacy from checkin_flow_state st where k='legacy';select st.v::uuid into g from checkin_flow_state st where k='g';select st.v::uuid into front from checkin_flow_state st where k='front';select st.v::jsonb into party from checkin_flow_state st where k='ids';
 details:=jsonb_build_object('room_id',legacy,'arrival',d,'departure',d+1,'adults',3,'children',0,'nightly_rate',800,'terms_at_checkin',true,'mode','checkin');
 v:=public.bite_reservation_quote(p,details);if(v->>'total')::numeric<>800 then raise exception 'Per-stay rent must override the unused room master rate';end if;
 reg:=jsonb_build_object('male',2,'female',1,'children',0,'arrived_from','Udaipur','next_destination','Jaipur','transport','Bus','id_front',front,'additional_ids',party);
 args:=details||jsonb_build_object('guest_id',g,'booking_mode','checkin','quote_hash',v->>'quote_hash','registration',reg);
 perform pg_temp.checkin_flow_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('registration',reg||jsonb_build_object('additional_ids',jsonb_build_array((party->0)||jsonb_build_object('id_front',front)))))::text));
 perform pg_temp.checkin_flow_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('registration',reg||jsonb_build_object('additional_ids',jsonb_build_array(party->0,party->0))))::text));
 perform pg_temp.checkin_flow_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('adults',1,'registration',reg||'{"male":1,"female":0}'::jsonb))::text));
 perform pg_temp.checkin_flow_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('nightly_rate',800.001))::text));
 v:=public.bite_property_command(p,'reserve',args,gen_random_uuid());s:=(v->>'id')::uuid;
 if not exists(select 1 from public.bite_stays where id=s and nightly_rate=800 and adults=3 and jsonb_array_length(registration->'additional_ids')=2)then raise exception 'Party check-in metadata or agreed price missing';end if;
 perform public.bite_property_command(p,'reservation_edit',jsonb_build_object('id',s,'room_id',legacy,'arrival',d,'departure',d+1,'adults',3,'children',0,'terms_at_checkin',true),gen_random_uuid());
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',s),gen_random_uuid());
 perform public.bite_property_command(p,'move',jsonb_build_object('id',s,'room_id',r),gen_random_uuid());
 if not exists(select 1 from public.bite_stays where id=s and nightly_rate=800 and room_id=r)then raise exception 'Moving rooms changed agreed rent or imposed an old capacity';end if;
 -- Same physical room, a later stay, a different agreed rent. The old room master remains historical.
 details:=jsonb_build_object('room_id',legacy,'arrival',d+2,'departure',d+3,'adults',1,'children',0,'nightly_rate',1250,'terms_at_checkin',true);
 args:=details||jsonb_build_object('guest_id',g,'registration',reg||jsonb_build_object('male',1,'female',0,'additional_ids','[]'::jsonb));
 v:=public.bite_property_command(p,'reserve',args,gen_random_uuid());
 if not exists(select 1 from public.bite_stays where id=(v->>'id')::uuid and nightly_rate=1250)or(select nightly_rate from public.bite_rooms where id=legacy)<>1500 then raise exception 'Per-stay terms overwrote another stay or historical master data';end if;
 perform pg_temp.checkin_flow_denied(format('select public.bite_reservation_quote(%L,%L)',p,(details-'nightly_rate'||jsonb_build_object('room_id',r))::text));
end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.checkin_flow_denied(format('select public.bite_guest_document_list(%L,%L)',(select v from checkin_flow_state st where k='p'),(select v from checkin_flow_state st where k='g')));
rollback;
select 'Room setup without presets, per-stay rent/counts, named multi-person IDs, private uploads, retries and tenant boundaries passed.'as result;
