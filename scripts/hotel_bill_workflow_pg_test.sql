-- Run only in the disposable CI database; all records roll back.
begin;
create temp table bill_qa(k text primary key,v text);grant all on bill_qa to authenticated;
create function pg_temp.bill_denied(q text)returns void language plpgsql as $$begin
 begin execute q;exception when sqlstate '42501'or sqlstate '22023'or sqlstate 'P0001'then return;end;
 raise exception 'Expected bill action denial: %',q;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
#variable_conflict use_column
declare p uuid;r uuid;g uuid;first_stay uuid;f uuid;v jsonb;d date:=(now()at time zone'Asia/Kolkata')::date;begin
 p:=public.bite_create_property('Synthetic bill workflow','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic shared payer","phone":"9999999999","address":"Synthetic address"}',gen_random_uuid())->>'id')::uuid;
 for i in 1..2 loop
  r:=(public.bite_property_command(p,'room_save',jsonb_build_object('number','BILL-'||i,'room_type','Deluxe'),gen_random_uuid())->>'id')::uuid;
  v:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',d,'departure',d+1,'adults',1,'children',0,'nightly_rate',case when i=1 then 1400 else 800 end,'terms_at_checkin',true,'booking_mode','checkin')||case when i=2 then jsonb_build_object('booking_stay_id',first_stay)else'{}'::jsonb end,gen_random_uuid());
  if i=1 then first_stay:=(v->>'id')::uuid;end if;
  perform public.bite_property_command(p,'checkin',jsonb_build_object('id',v->>'id'),gen_random_uuid());
  insert into bill_qa values('f'||i,v->>'folio_id'),('s'||i,v->>'id'),('r'||i,r);
 end loop;
 if(select count(distinct group_id)from public.bite_stays where property_id=p)<>1 or exists(select 1 from public.bite_stays where property_id=p and group_id is null)then raise exception 'Rooms were not linked to one booking';end if;
 insert into bill_qa values('p',p),('g',g),('group',(select group_id from public.bite_stays where id=first_stay));
 perform public.bite_property_command(p,'member','{"id":"33333333-3333-4333-8333-333333333333","role":"receptionist","active":true}',gen_random_uuid());
end$$;
reset role;
insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by)
values((select v::uuid from bill_qa where k='p'),(select v::uuid from bill_qa where k='f1'),'charge','food','Synthetic restaurant food',650,0,'11111111-1111-4111-8111-111111111111');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
#variable_conflict use_column
declare p uuid:=(select v::uuid from bill_qa where k='p');f1 uuid:=(select v::uuid from bill_qa where k='f1');f2 uuid:=(select v::uuid from bill_qa where k='f2');v jsonb;args jsonb;request uuid:=gen_random_uuid();ids jsonb;pending uuid;begin
 perform public.bite_property_command(p,'billing_settings','{"prefix":"H","next_number":42,"primary_account":"Synthetic second account","tax_profile":{"gstin":"08ABCDE1234F1Z5","reviewed":true,"room_rate":5,"food_rate":5,"incidental_rate":5}}',gen_random_uuid());
 perform public.bite_property_command(p,'folio_tax',jsonb_build_object('folio_id',f1,'mode','gst'),gen_random_uuid());
 perform public.bite_property_command(p,'folio_tax',jsonb_build_object('folio_id',f2,'mode','gst'),gen_random_uuid());
 v:=(select totals from jsonb_to_recordset(public.bite_hotel_workspace(p)->'folios')as x(id uuid,totals jsonb)where id=f1);
 if(v->>'charges')::numeric<>2152.50 or(v->>'balance')::numeric<>2152.50 then raise exception 'Room + food GST was not added to the bill';end if;
 perform pg_temp.bill_denied(format('select public.bite_property_command(%L,''folio_tax'',%L,gen_random_uuid())',p,jsonb_build_object('folio_id',f1,'mode','plain')::text));
 pending:=(public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f1,'amount',400,'method','UPI','description','Synthetic pending UPI','reference','SYNTHETIC-UPI'),gen_random_uuid())->>'id')::uuid;
 perform public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f1,'amount',2152.5,'method','Cash','description','Actual cash received'),gen_random_uuid());
 perform pg_temp.bill_denied(format('select public.bite_property_command(%L,''checkout_collect'',%L,gen_random_uuid())',p,jsonb_build_object('folio_id',f1,'amount',0)::text));
 if not exists(select 1 from public.bite_stays where id=(select v::uuid from bill_qa where k='s1')and status='in_house')then raise exception 'Pending receipt was silently ignored';end if;
 insert into bill_qa values('pending',pending);
end$$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.bill_denied(format('select public.bite_property_command(%L,''payment_void'',%L,gen_random_uuid())',(select v from bill_qa where k='p'),jsonb_build_object('id',(select v from bill_qa where k='pending'),'folio_id',(select v from bill_qa where k='f1'),'description','Not received')::text));
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
#variable_conflict use_column
declare p uuid:=(select v::uuid from bill_qa where k='p');f1 uuid:=(select v::uuid from bill_qa where k='f1');f2 uuid:=(select v::uuid from bill_qa where k='f2');ids jsonb;args jsonb;v jsonb;request uuid:=gen_random_uuid();begin
 perform public.bite_property_command(p,'payment_void',jsonb_build_object('id',(select v from bill_qa where k='pending'),'folio_id',f1,'description','Pending UPI was not received'),gen_random_uuid());
 select jsonb_agg(x order by x)into ids from(select f1::text x union all select f2::text)x;
 args:=jsonb_build_object('group_id',(select st.v from bill_qa st where k='group'),'folio_ids',ids,'amount',840,'method','UPI','verified',true,'reference','SYNTHETIC-COMBINED','account_note','Synthetic second account');
 perform pg_temp.bill_denied(format('select public.bite_property_command(%L,''booking_checkout_collect'',%L,gen_random_uuid())',p,(args||'{"amount":1}'::jsonb)::text));
 v:=public.bite_property_command(p,'booking_checkout_collect',args,request);
 if public.bite_property_command(p,'booking_checkout_collect',args,request)<>v then raise exception 'Booking checkout retry changed its result';end if;
 if jsonb_array_length(v->'invoices')<>2 or(select count(*)from public.bite_folios where property_id=p and status='settled')<>2 then raise exception 'Shared booking did not issue two attached room invoices';end if;
 if exists(select 1 from public.bite_rooms where property_id=p and housekeeping<>'ready')then raise exception 'Housekeeping OFF did not release checked-out rooms';end if;
 if exists(select 1 from public.bite_service_tasks where property_id=p and kind='cleaning'and status not in('cancelled','completed'))then raise exception 'Housekeeping OFF created a cleaning queue';end if;
 if(select count(*)from public.bite_folio_entries where property_id=p and kind='payment'and method='UPI'and status='confirmed')<>1 then raise exception 'Retry duplicated the grouped online receipt';end if;
 if not exists(select 1 from public.bite_folios where id=f1 and invoice_snapshot->'gst'@>'[{"category":"room","rate":5,"cgst":35,"sgst":35},{"category":"food","rate":5,"cgst":16.25,"sgst":16.25}]'::jsonb)then raise exception 'Issued GST split missing or incorrect';end if;
 perform pg_temp.bill_denied(format('select public.bite_property_command(%L,''folio_tax'',%L,gen_random_uuid())',p,jsonb_build_object('folio_id',f1,'mode','gst')::text));
end$$;
reset role;
-- Retained IDs are synthetic Storage metadata; no real identity copy is used.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
#variable_conflict use_column
declare p uuid:=(select v::uuid from bill_qa where k='p');g uuid:=(select v::uuid from bill_qa where k='g');front uuid:=gen_random_uuid();back uuid:=gen_random_uuid();v jsonb;args jsonb;r uuid;reg jsonb;begin
 foreach r in array array[front,back]loop
  v:=public.bite_guest_document_command(p,g,r,'begin','{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}');perform set_config('storage.operation','object.upload',true);
  insert into storage.objects(bucket_id,name,metadata,owner_id)values('bite-guest-documents',v->>'object_path','{"size":8,"mimetype":"image/png"}',auth.uid()::text);
  perform public.bite_guest_document_command(p,g,r,'finish');
 end loop;
 r:=(public.bite_property_command(p,'room_save','{"number":"ID-QA","room_type":"Deluxe"}',gen_random_uuid())->>'id')::uuid;
 reg:=jsonb_build_object('flow_version',3,'male',1,'female',0,'children',0,'arrived_from','Udaipur','next_destination','Jaipur','transport','Bus','id_front',front,'additional_ids','[]'::jsonb);
 args:=jsonb_build_object('guest_id',g,'room_id',r,'arrival',(now()at time zone'Asia/Kolkata')::date,'departure',(now()at time zone'Asia/Kolkata')::date+1,'adults',1,'children',0,'nightly_rate',900,'terms_at_checkin',true,'registration',reg);
 perform pg_temp.bill_denied(format('select public.bite_property_command(%L,''reserve'',%L,gen_random_uuid())',p,args::text));
 perform public.bite_property_command(p,'reserve',args||jsonb_build_object('registration',reg||jsonb_build_object('id_back',back)),gen_random_uuid());
 r:=(public.bite_property_command(p,'room_save','{"number":"HIGH-GST-QA","room_type":"Deluxe"}',gen_random_uuid())->>'id')::uuid;
 perform public.bite_property_command(p,'room_status',jsonb_build_object('id',r,'status','dirty'),gen_random_uuid());
 args:=args||jsonb_build_object('room_id',r,'nightly_rate',8000,'booking_mode','checkin','registration',reg||jsonb_build_object('id_back',back));
 v:=public.bite_reservation_quote(p,args||'{"mode":"checkin"}'::jsonb);
 if(v->>'room_tax')::numeric<>1440 then raise exception 'High room GST quote is incorrect';end if;
 v:=public.bite_property_command(p,'reserve',args||jsonb_build_object('quote_hash',v->>'quote_hash'),gen_random_uuid());
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',v->>'id'),gen_random_uuid());
 if not exists(select 1 from public.bite_stays where id=(v->>'id')::uuid and room_tax_rate=18 and status='in_house')then raise exception 'Housekeeping OFF or high room GST rate did not reach check-in';end if;
end$$;
reset role;
do $$begin if has_function_privilege('authenticated','private.bite_apply_bill_tax(uuid,uuid,text)','execute')then raise exception 'Internal tax helper is exposed';end if;end$$;
rollback;
select 'GST totals, compulsory ID back, pending-receipt resolution, linked rooms, atomic shared checkout, retries and housekeeping OFF passed.' as result;
