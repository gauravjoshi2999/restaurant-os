-- Disposable database only. All synthetic records roll back.
begin;
create temp table scenario_state(k text primary key,v text);
grant all on scenario_state to authenticated;
create function pg_temp.scenario_denied(q text,expected_field text default null)returns void language plpgsql as $$
declare detail_text text;begin
 begin execute q;
 exception when sqlstate '42501'or sqlstate '22023'or sqlstate 'P0001'then
  get stacked diagnostics detail_text=pg_exception_detail;
  if expected_field is not null and(detail_text::jsonb->>'field')is distinct from expected_field then raise exception 'Wrong correction field: %',detail_text;end if;return;
 end;raise exception 'Expected denial: %',q;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$declare p uuid;r uuid;g uuid;doc uuid:=gen_random_uuid();req uuid:=gen_random_uuid();abandon uuid:=gen_random_uuid();v jsonb;args jsonb;reg jsonb;foreign_info jsonb;d date:=(now()at time zone'Asia/Kolkata')::date;k text;begin
 p:=public.bite_create_property('Synthetic 25 scenarios','hotel',gen_random_uuid());
 r:=(public.bite_property_command(p,'room_save','{"number":"QA25","room_type":"Deluxe"}',gen_random_uuid())->>'id')::uuid;
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic foreign guest","phone":"9999999999","address":"Synthetic foreign address","country":"France"}',req)->>'id')::uuid;
 perform public.bite_property_command(p,'member','{"id":"33333333-3333-4333-8333-333333333333","role":"receptionist","active":true}',gen_random_uuid());
 v:=public.bite_guest_document_command(p,g,doc,'begin','{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}');
 perform set_config('storage.operation','object.upload',true);
 insert into storage.objects(bucket_id,name,metadata,owner_id)values('bite-guest-documents',v->>'object_path','{"size":8,"mimetype":"image/png"}',auth.uid()::text);
 perform public.bite_guest_document_command(p,g,doc,'finish');
 foreign_info:=jsonb_build_object('nationality','France','date_of_birth','1990-01-01','document_type','passport','document_last4','A123','document_expiry',(d+500)::text,'visa_status','visa','permission_last4','V123','visa_expiry',(d+100)::text,'india_arrival',(d-1)::text,'entry_port','Delhi','purpose','Tourism');
 reg:=jsonb_build_object('flow_version',2,'male',1,'female',0,'children',0,'arrived_from','Delhi','next_destination','Udaipur','transport','Bus','id_front',doc,'additional_ids','[]'::jsonb,'foreign_details',foreign_info);
 args:=jsonb_build_object('guest_id',g,'room_id',r,'arrival',d,'departure',d+1,'arrival_time','07:17','adults',1,'children',0,'nightly_rate',900,'terms_at_checkin',true,'registration',reg,'advance_amount',100,'advance_method','Cash');
 foreach k in array array['document_last4','document_expiry','visa_expiry','india_arrival']loop
  v:=jsonb_set(args,array['registration','foreign_details',k],to_jsonb(case when k='document_last4'then'FULL123456'when k='india_arrival'then(d+1)::text else(d-1)::text end));
  perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,v::text),'foreign_'||k);
 end loop;
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,(args||jsonb_build_object('registration',reg-'foreign_details'))::text),'country');
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,jsonb_set(args,'{registration,foreign_details,nationality}','"Germany"')::text),'country');
 -- Unknown send is first tombstoned, so a late copy cannot create a stay or advance.
 v:=public.bite_property_command(p,'abandon_checkin',jsonb_build_object('id',abandon),gen_random_uuid());
 if not(v->>'cancelled')::boolean then raise exception 'Missing cancellation tombstone';end if;
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,%L)',p,args::text,abandon));
 if exists(select 1 from public.bite_stays where property_id=p)then raise exception 'Abandoned late request created a stay';end if;
 -- A committed response lost by the browser is discovered, never cancelled or charged twice.
 abandon:=gen_random_uuid();v:=public.bite_property_command(p,'reserve',args,abandon);
 if public.bite_property_command(p,'reserve',args,abandon)<>v then raise exception 'Retry response differs';end if;
 if(select count(*)from public.bite_stays where property_id=p)<>1 or(select count(*)from public.bite_folio_entries where property_id=p and kind='advance')<>1 then raise exception 'Duplicate booking or advance';end if;
 v:=public.bite_property_command(p,'abandon_checkin',jsonb_build_object('id',abandon),gen_random_uuid());
 if v->>'action'<>'reserve'or not(v->>'found')::boolean then raise exception 'Committed reservation was not reconciled';end if;
 v:=public.bite_hotel_workspace(p);
 if not exists(select 1 from jsonb_array_elements(v->'checkin_attempts')a where a->>'request_id'=abandon::text and a->>'action'='reserve')then raise exception 'Own lost response not returned';end if;
 if exists(select 1 from jsonb_array_elements(v->'checkin_attempts')a where a?'payload')then raise exception 'Attempt workspace leaked raw payload';end if;
 insert into scenario_state values('p',p),('request',abandon),('owner_guest_request',req);
 -- Occupancy/date race must also be rejected by the actual server.
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,args::text));
end$$;
-- Own attempts only, even for another authorized receptionist in the same property.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare p uuid:=(select v::uuid from scenario_state where k='p');v jsonb;begin
 v:=public.bite_hotel_workspace(p);
 if jsonb_array_length(v->'checkin_attempts')<>0 then raise exception 'Another staff member can inspect request history';end if;
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''abandon_checkin'',%L,gen_random_uuid())',p,jsonb_build_object('id',(select st.v from scenario_state st where k='request'))::text));
end$$;
reset role;
-- Seed an overdue physical occupant only in this disposable transaction.
-- Its old dates no longer overlap today: date exclusion alone cannot catch this case.
update public.bite_stays set status='in_house',arrival=(now()at time zone'Asia/Kolkata')::date-2,departure=(now()at time zone'Asia/Kolkata')::date where property_id=(select v::uuid from scenario_state where k='p');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$declare p uuid:=(select v::uuid from scenario_state where k='p');s public.bite_stays;args jsonb;d date:=(now()at time zone'Asia/Kolkata')::date;begin
 select * into strict s from public.bite_stays where property_id=p;
 args:=jsonb_build_object('guest_id',s.guest_id,'room_id',s.room_id,'arrival',d,'departure',d+1,'adults',1,'children',0,'nightly_rate',900,'terms_at_checkin',true,'booking_mode','checkin','advance_amount',100,'advance_method','Cash');
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,args::text),'room_id');
 if(select count(*)from public.bite_stays where property_id=p)<>1 or(select count(*)from public.bite_folio_entries where property_id=p and kind='advance')<>1 then raise exception 'Overdue occupant denial created a booking or advance';end if;
 args:=args||jsonb_build_object('arrival',d+2,'departure',d+3);
 perform pg_temp.scenario_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,args::text),'arrival');
 perform public.bite_property_command(p,'reserve',args||'{"booking_mode":"reserve"}'::jsonb,gen_random_uuid());
end$$;
reset role;
-- Pure helper stays non-definer and inaccessible to public application roles.
do $$declare v jsonb;d date:=current_date;begin
 if has_function_privilege('authenticated','private.bite_validate_foreign_details(jsonb,date,text)','execute')or(select prosecdef from pg_proc where oid='private.bite_validate_foreign_details(jsonb,date,text)'::regprocedure)then raise exception 'Foreign helper elevated application privileges';end if;
 v:=jsonb_build_object('nationality','France','date_of_birth','1990-01-01','document_type','passport','document_last4','A123','document_expiry',d+100,'visa_status','oci','permission_last4','O123','india_arrival',d,'entry_port','Delhi','purpose','Family visit');
 perform private.bite_validate_foreign_details(v,d);
 v:=v||'{"nationality":"Nepal","document_type":"travel_document","document_no_expiry":true,"document_expiry":"","visa_status":"exempt","permission_last4":""}'::jsonb;
 perform private.bite_validate_foreign_details(v,d);
end$$;
rollback;
select 'Foreign / OCI / exempt dates, occupied-room race, scoped lost-response reconciliation and late-send tombstones passed.'as result;
