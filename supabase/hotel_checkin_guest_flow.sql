-- Per-stay room terms and named companion ID attachments in the existing scoped hotel workflow.
-- Apply after hotel_register_arrival_time.sql. No historical room/stay amounts are overwritten.
begin;
do $preflight$begin
 if md5(pg_get_functiondef('private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb)'::regprocedure))not in('9f7b1a550f4c555240d0534ef210e914','29265eb3ea926ac7323aab3ceef1fc11')then raise exception 'Function changed since review: private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb)';end if;
 if md5(pg_get_functiondef('private.bite_guest_document_list(uuid,uuid)'::regprocedure))not in('587f6bcb25cc177514767840080edeee','0964235d86c4cbcfcdda74140276189d')then raise exception 'Function changed since review: private.bite_guest_document_list(uuid,uuid)';end if;
 if md5(pg_get_functiondef('private.bite_hotel_account_command(uuid,text,jsonb,uuid)'::regprocedure))not in('5eefffb740346152bc6a77f16a7ed70e','020b9c1404d3323a0df5cc5f56f0dd5f')then raise exception 'Function changed since review: private.bite_hotel_account_command(uuid,text,jsonb,uuid)';end if;
 if md5(pg_get_functiondef('private.bite_property_command(uuid,text,jsonb,uuid)'::regprocedure))not in('7de362ee97e804d9fe53849d0e8753e2','837caa0618ced0921b77fca74fedbc24')then raise exception 'Function changed since review: private.bite_property_command(uuid,text,jsonb,uuid)';end if;
 if md5(pg_get_functiondef('private.bite_reservation_quote(uuid,jsonb)'::regprocedure))not in('61900ed6af76bfb8e570ce722b7af8fe','fe054971daad239448548d96d88eb6ed')then raise exception 'Function changed since review: private.bite_reservation_quote(uuid,jsonb)';end if;
end$preflight$;
alter table public.bite_rooms alter column nightly_rate drop not null,alter column adults drop not null,alter column children drop not null;
alter table public.bite_rooms alter column nightly_rate drop default,alter column adults drop default,alter column children drop default;
alter table public.bite_guest_documents add column if not exists subject_key uuid;
comment on column public.bite_guest_documents.subject_key is 'Optional person reference for a named companion ID attached to the lead guest stay; private to authorized property staff.';

CREATE OR REPLACE FUNCTION private.bite_guest_document_command(p_property uuid, p_guest uuid, p_document uuid, p_action text, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.bite_guest_documents; g uuid; object_meta jsonb; object_owner text; ext text; subject uuid;
begin
 if auth.uid() is null or not private.bite_can(p_property,'guest_register') then
  raise exception 'Guest document access denied' using errcode='42501';
 end if;
 -- Serialize per-person and whole-party copy limits, including unknown-response retries.
 select id into g from public.bite_guests where property_id=p_property and id=p_guest for update;
 if g is null then raise exception 'Guest not found in this property' using errcode='P0002'; end if;
 if p_document is null then raise exception 'Document request ID required' using errcode='22023'; end if;
 select * into d from public.bite_guest_documents where id=p_document for update;
 if d.id is not null and (d.property_id<>p_property or d.guest_id<>p_guest) then
  raise exception 'Document does not belong to this guest' using errcode='42501';
 end if;
 if p_action='begin' then
  subject:=nullif(p_details->>'subject_key','')::uuid;
  if coalesce(p_details->>'kind','') not in ('masked_id','travel_record','supporting_record') or
     coalesce(p_details->>'mime_type','') not in ('image/jpeg','image/png','application/pdf') or
     coalesce(p_details->>'byte_size','') !~ '^[0-9]{1,7}$' or
     not coalesce((p_details->>'redacted_confirmed')::boolean,false) then
   raise exception 'Choose a supported masked copy and confirm necessary, redacted information only' using errcode='22023';
  end if;
  if (p_details->>'byte_size')::integer not between 1 and 4194304 then
   raise exception 'Document must be at most 4 MB' using errcode='22023';
  end if;
  if d.id is not null then
   if d.created_by<>auth.uid() or d.status='deleted' or d.kind<>p_details->>'kind' or
      d.mime_type<>p_details->>'mime_type' or d.byte_size<>(p_details->>'byte_size')::integer or d.subject_key is distinct from subject then
    raise exception 'Document request already has different details. Refresh before retrying' using errcode='22023';
   end if;
  else
   if (select count(*) from public.bite_guest_documents where property_id=p_property and guest_id=p_guest and status<>'deleted')>=80 then raise exception 'Retained party copy limit reached. Remove unnecessary copies first'using errcode='22023';end if;
   if (select count(*) from public.bite_guest_documents where property_id=p_property and guest_id=p_guest and status<>'deleted'and subject_key is not distinct from subject)>=5 then
    raise exception 'Five copies already exist. Remove an unnecessary or unfinished copy first' using errcode='22023';
   end if;
   ext:=case p_details->>'mime_type' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end;
   insert into public.bite_guest_documents(id,property_id,guest_id,kind,mime_type,byte_size,object_path,created_by,subject_key)
    values(p_document,p_property,p_guest,p_details->>'kind',p_details->>'mime_type',(p_details->>'byte_size')::integer,
     p_property::text||'/'||p_guest::text||'/'||p_document::text||ext,auth.uid(),subject) returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_begin',p_document,p_document);
  end if;
 elsif p_action='finish' then
  if d.id is null or d.status='deleted' or d.created_by<>auth.uid() then
   raise exception 'Your unfinished document upload is required' using errcode='42501';
  end if;
  if d.status='pending' then
   select metadata,owner_id into object_meta,object_owner from storage.objects
    where bucket_id='bite-guest-documents' and name=d.object_path;
   if object_meta is null or coalesce(object_meta->>'size','') !~ '^[0-9]{1,7}$' or
      (object_meta->>'size')::integer<>d.byte_size or object_meta->>'mimetype' is distinct from d.mime_type or
      object_owner is distinct from d.created_by::text then
    raise exception 'Upload not confirmed. Retry the same file, or remove the unfinished copy' using errcode='22023';
   end if;
   update public.bite_guest_documents set status='ready',completed_at=now() where id=d.id returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_complete',p_document,p_document);
  end if;
 elsif p_action='forget' then
  if d.id is null then raise exception 'Document not found' using errcode='P0002'; end if;
  if exists(select 1 from storage.objects where bucket_id='bite-guest-documents' and name=d.object_path) then
   raise exception 'File deletion is not confirmed. Retry Remove; the copy is still retained' using errcode='22023';
  end if;
  if d.status<>'deleted' then
   update public.bite_guest_documents set status='deleted',deleted_at=now() where id=d.id returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_delete',p_document,p_document);
  end if;
 else raise exception 'Unknown document action' using errcode='22023';
 end if;
 return jsonb_build_object('id',d.id,'object_path',d.object_path,'status',d.status);
end $function$;

CREATE OR REPLACE FUNCTION private.bite_guest_document_list(p_property uuid, p_guest uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not private.bite_can(p_property,'guest_register') then
  raise exception 'Guest document access denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.bite_guests where property_id=p_property and id=p_guest) then
  raise exception 'Guest not found in this property' using errcode='P0002';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'mime_type',d.mime_type,
  'byte_size',d.byte_size,'object_path',d.object_path,'status',d.status,'created_at',d.created_at,
  'subject_key',d.subject_key,'can_finish',d.created_by=auth.uid()) order by d.created_at desc),'[]'::jsonb)
  from public.bite_guest_documents d where d.property_id=p_property and d.guest_id=p_guest and d.status<>'deleted');
end $function$;

CREATE OR REPLACE FUNCTION private.bite_hotel_account_command(p_property uuid, p_action text, p_payload jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr public.bite_properties;prior public.bite_property_commands;role_name text;v jsonb;cfg jsonb;t jsonb;s public.bite_stays;f public.bite_folios;series public.bite_invoice_series;
 entity uuid;fid uuid;amount numeric;d date;k text;custom boolean:=false;party_item jsonb;party jsonb;begin
 if auth.uid()is null or p_request is null or jsonb_typeof(p_payload)is distinct from 'object'then raise exception 'Authenticated request and details required'using errcode='42501';end if;
 role_name:=private.bite_property_role(p_property);
 if role_name is null then raise exception 'Property access denied'using errcode='42501';end if;
 select * into strict pr from public.bite_properties where id=p_property for update;
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.created_by<>auth.uid()then raise exception 'Request ID already used for different details';end if;return prior.result;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;
 if p_action in ('billing_settings','daybook_entry','account_note')then
  custom:=true;
  if role_name not in ('owner','manager')or not private.bite_can(p_property,'reporting')then raise exception 'Owner or manager access required'using errcode='42501';end if;
 end if;
 if p_action='billing_settings'then
  if not private.bite_can(p_property,'manage_modules')then raise exception 'Billing settings access denied'using errcode='42501';end if;
  cfg:=p_payload->'tax_profile';
  if not coalesce((cfg->>'reviewed')::boolean,false)then raise exception 'Review GST registration and rates';end if;
  if coalesce(cfg->>'gstin','')<>''and upper(cfg->>'gstin')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'then raise exception 'Enter a valid GSTIN';end if;
  if coalesce((cfg->>'room_rate')::numeric,-1)not in(0,5,18)or coalesce((cfg->>'food_rate')::numeric,-1)not in(0,5,18)or coalesce((cfg->>'incidental_rate')::numeric,-1)not between 0 and 100 then raise exception 'Review applicable GST rates';end if;
  if coalesce(cfg->>'gstin','')=''and((cfg->>'room_rate')::numeric<>0 or(cfg->>'food_rate')::numeric<>0 or(cfg->>'incidental_rate')::numeric<>0)then raise exception 'GSTIN required before charging GST';end if;
  if coalesce(p_payload->>'prefix','')!~'^[A-Za-z0-9]{1,3}$'or coalesce((p_payload->>'next_number')::integer,0)not between 1 and 999999 then raise exception 'Use a 1–3 character prefix and next number 1–999999';end if;
  if length(trim(coalesce(p_payload->>'primary_account','')))>80 then raise exception 'Account label is too long';end if;
  select * into series from public.bite_invoice_series where property_id=p_property and financial_year=private.bite_financial_year(now(),pr.timezone)for update;
  if series.last_number is not null and(p_payload->>'next_number')::integer<=series.last_number then raise exception 'Next number must be above issued bills';end if;
  insert into public.bite_invoice_series(property_id,financial_year,prefix,next_number,last_number)values(p_property,private.bite_financial_year(now(),pr.timezone),upper(p_payload->>'prefix'),(p_payload->>'next_number')::integer,0)on conflict(property_id,financial_year)do update set prefix=excluded.prefix,next_number=excluded.next_number;
  update public.bite_properties set tax_profile=cfg||jsonb_build_object('gstin',upper(coalesce(cfg->>'gstin','')),'primary_account',trim(coalesce(p_payload->>'primary_account',''))),updated_at=now()where id=p_property;entity:=p_property;
 elsif p_action='daybook_entry'then
  amount:=(p_payload->>'amount')::numeric;k:=p_payload->>'kind';d:=(p_payload->>'entry_date')::date;
  if amount is null or amount not between 0.01 and 9999999999.99 or amount<>round(amount,2)then raise exception 'Enter a positive amount with at most two decimals';end if;
  if k is null or k not in('income','expense','staff_advance','salary_expense','salary_payment','opening','transfer_in','transfer_out')or d is null or d>(now()at time zone pr.timezone)::date then raise exception 'Choose a valid entry type and date';end if;
  if exists(select 1 from public.bite_property_shift_closings where property_id=p_property and shift_date=d and locked)or exists(select 1 from public.restaurant_cashbook_closings c join public.bite_property_outlets o on o.restaurant_id=c.restaurant_id where o.property_id=p_property and c.close_date=d)then raise exception 'Day is closed. Use a correction on an open day';end if;
  if length(trim(coalesce(p_payload->>'description','')))not between 1 and 250 or length(trim(coalesce(p_payload->>'category','')))not between 1 and 80 then raise exception 'Category and reason required';end if;
  if p_payload->>'method'is null or p_payload->>'method'not in('Cash','UPI','Card','Bank Transfer','Non-cash')or((k='salary_expense')<>(p_payload->>'method'='Non-cash'))then raise exception 'Select Cash/Online. Earned salary is a non-cash expense';end if;
  if k in('staff_advance','salary_expense','salary_payment')and length(trim(coalesce(p_payload->>'staff_name','')))<1 then raise exception 'Staff name required';end if;
  if k='salary_payment'and not exists(select 1 from public.bite_daily_book_entries where property_id=p_property and kind='salary_expense'and lower(staff_name)=lower(trim(p_payload->>'staff_name'))and date_trunc('month',entry_date)=date_trunc('month',d))then raise exception 'Record the earned monthly salary first; then pay its balance after advances';end if;
  if k='salary_expense'and exists(select 1 from public.bite_daily_book_entries where property_id=p_property and kind=k and lower(staff_name)=lower(trim(p_payload->>'staff_name'))and date_trunc('month',entry_date)=date_trunc('month',d))then raise exception 'Earned salary already recorded for this staff member and month';end if;
  if p_payload->>'method'not in('Cash','Non-cash')and not coalesce((p_payload->>'verified')::boolean,false)then raise exception 'Verify online money movement before saving';end if;
  insert into public.bite_daily_book_entries(property_id,entry_date,kind,category,description,amount,method,account_note,staff_name,created_by)
  values(p_property,d,k,trim(p_payload->>'category'),trim(p_payload->>'description'),amount,p_payload->>'method',left(trim(coalesce(p_payload->>'account_note',pr.tax_profile->>'primary_account','')),80),left(trim(coalesce(p_payload->>'staff_name','')),120),auth.uid())returning id into entity;
 elsif p_action='account_note'then
  if length(trim(coalesce(p_payload->>'account_note','')))not between 1 and 80 then raise exception 'Account label must be 1–80 characters';end if;
  if p_payload->>'source_type'='folio'then
   update public.bite_folio_entries set account_note=trim(p_payload->>'account_note')where property_id=p_property and id=entity and method in('UPI','Card','Bank Transfer');if not found then raise exception 'Online receipt not found';end if;
  elsif p_payload->>'source_type'='daybook'then
   update public.bite_daily_book_entries set account_note=trim(p_payload->>'account_note')where property_id=p_property and id=entity and method in('UPI','Card','Bank Transfer');if not found then raise exception 'Online entry not found';end if;
  else
   if not exists(select 1 from public.restaurant_cashbook_entries e join public.bite_property_outlets o on o.restaurant_id=e.restaurant_id where o.property_id=p_property and e.entry_id=entity and e.source_type=p_payload->>'source_type'and e.payment_method in('UPI','Card','Bank Transfer'))then raise exception 'Online outlet receipt not found';end if;
   insert into public.bite_payment_account_notes values(p_property,p_payload->>'source_type',entity,trim(p_payload->>'account_note'))on conflict(property_id,source_type,source_id)do update set account_note=excluded.account_note;
  end if;
 elsif p_action='checkout_collect'then
  custom:=true;
  if role_name not in('owner','manager','receptionist')or not private.bite_can(p_property,'folios')then raise exception 'Checkout access denied'using errcode='42501';end if;
  select * into strict f from public.bite_folios where property_id=p_property and id=(p_payload->>'folio_id')::uuid;
  if f.status='settled'then v:=jsonb_build_object('id',f.stay_id,'folio_id',f.id,'invoice',f.invoice_snapshot);
  else
   t:=private.bite_folio_totals(f.id);amount:=coalesce((p_payload->>'amount')::numeric,0);
   if amount is distinct from(t->>'balance')::numeric or amount<0 then raise exception 'Balance changed. Review checkout again';end if;
   if amount>0 then
    v:=private.bite_hotel_account_command(p_property,'payment',p_payload||jsonb_build_object('description','Final checkout payment'),gen_random_uuid());
    if p_payload->>'method'in('UPI','Card','Bank Transfer')then
     if not coalesce((p_payload->>'verified')::boolean,false)then raise exception 'Confirm the receipt in the bank account';end if;
     perform private.bite_hotel_account_command(p_property,'payment_confirm',jsonb_build_object('id',v->>'id','folio_id',f.id,'description','Checkout payment verified','reference',p_payload->>'reference','account_note',p_payload->>'account_note'),gen_random_uuid());
    end if;
   end if;
   v:=private.bite_hotel_account_command(p_property,'checkout',jsonb_build_object('folio_id',f.id),gen_random_uuid());
  end if;entity:=f.stay_id;fid:=f.id;
 else
  if p_action in('reserve','reservation_edit')and p_payload?'arrival_time'then
   if jsonb_typeof(p_payload->'arrival_time')is distinct from 'string'or(p_payload->>'arrival_time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'then
    raise exception 'Enter a valid arrival time.'using errcode='22023',detail='{"field":"arrival_time"}';
   end if;
  end if;
  if p_action='reserve'and p_payload?'registration'then
   cfg:=p_payload->'registration';
   if jsonb_typeof(cfg)is distinct from 'object'or coalesce((cfg->>'male')::integer,-1)not between 0 and 20 or coalesce((cfg->>'female')::integer,-1)not between 0 and 20 or(cfg->>'male')::integer+(cfg->>'female')::integer is distinct from(p_payload->>'adults')::integer then raise exception 'Male + female counts must match adult guests';end if;
   if length(trim(coalesce(cfg->>'arrived_from','')))not between 1 and 120 or length(trim(coalesce(cfg->>'next_destination','')))not between 1 and 120 or cfg->>'transport'is null or cfg->>'transport'not in('Car','Bike','Bus','Train','Other')or(cfg->>'transport'in('Car','Bike')and length(trim(coalesce(cfg->>'vehicle_number','')))<4)then raise exception 'Enter arrival place, destination and vehicle details';end if;
   if not exists(select 1 from public.bite_guests where property_id=p_property and id=(p_payload->>'guest_id')::uuid and length(trim(address))>0)then raise exception 'Permanent address is required';end if;
   if not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=nullif(cfg->>'id_front','')::uuid and kind='masked_id'and status='ready'and subject_key is null)then raise exception 'Upload the ID front before confirming check-in';end if;
   party:=coalesce(cfg->'additional_ids','[]'::jsonb);
   if jsonb_typeof(party)is distinct from 'array'then raise exception 'Check the additional guest IDs'using errcode='22023';end if;
   if jsonb_array_length(party)>(p_payload->>'adults')::integer+coalesce((p_payload->>'children')::integer,0)-1 or jsonb_array_length(party)>39 then raise exception 'Additional IDs exceed the number of guests'using errcode='22023';end if;
   if (select count(distinct x->>'subject_key')from jsonb_array_elements(party)x)<>jsonb_array_length(party)then raise exception 'Each guest ID needs its own person reference'using errcode='22023';end if;
   for party_item in select value from jsonb_array_elements(party)loop
    if length(trim(coalesce(party_item->>'name','')))not between 1 and 120 or nullif(party_item->>'subject_key','')is null then raise exception 'Enter the name on each additional guest ID'using errcode='22023';end if;
    if not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=nullif(party_item->>'id_front','')::uuid and subject_key=(party_item->>'subject_key')::uuid and kind='masked_id'and status='ready')then raise exception 'Save the ID front for each additional guest'using errcode='22023';end if;
    if nullif(party_item->>'id_back','')is not null and (party_item->>'id_back'=party_item->>'id_front'or not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=(party_item->>'id_back')::uuid and subject_key=(party_item->>'subject_key')::uuid and kind='masked_id'and status='ready'))then raise exception 'Check the additional guest ID back'using errcode='22023';end if;
   end loop;
   if nullif(cfg->>'id_back','')is not null and not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=(cfg->>'id_back')::uuid and status='ready'and kind='masked_id'and subject_key is null)then raise exception 'ID back has not been saved for this guest';end if;
  end if;
  if p_action='reservation_edit'then
   select * into strict s from public.bite_stays where property_id=p_property and id=entity;
   if jsonb_array_length(coalesce(s.registration->'additional_ids','[]'::jsonb))>coalesce((p_payload->>'adults')::integer,0)+coalesce((p_payload->>'children')::integer,0)-1 then raise exception 'Guest count is smaller than the attached party IDs'using errcode='22023',detail='{"field":"male"}';end if;
  end if;
  if p_action='checkin'then
   select * into strict s from public.bite_stays where property_id=p_property and id=entity;
   if exists(select 1 from jsonb_array_elements(coalesce(s.registration->'additional_ids','[]'::jsonb))x where not exists(select 1 from public.bite_guest_documents d where d.property_id=p_property and d.guest_id=s.guest_id and d.id=(x->>'id_front')::uuid and d.subject_key=(x->>'subject_key')::uuid and d.status='ready'))then raise exception 'An additional guest ID front is unavailable';end if;
   if s.registration is not null and not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=s.guest_id and id=(s.registration->>'id_front')::uuid and status='ready')then raise exception 'The required ID front is unavailable';end if;
  end if;
  if p_action='config'and p_payload?'tax_profile'and coalesce((p_payload->'tax_profile'->>'reviewed')::boolean,false)then
   cfg:=p_payload->'tax_profile';
   if (coalesce((cfg->>'room_rate')::numeric,0)>0 or coalesce((cfg->>'food_rate')::numeric,0)>0 or coalesce((cfg->>'incidental_rate')::numeric,0)>0)and coalesce(upper(cfg->>'gstin'),'')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'then raise exception 'Review a valid GSTIN before enabling GST rates';end if;
  end if;
  v:=private.bite_property_command(p_property,p_action,p_payload,p_request);entity:=(v->>'id')::uuid;fid:=nullif(v->>'folio_id','')::uuid;
  if p_action in('reserve','reservation_edit')and p_payload?'arrival_time'then
   update public.bite_stays set arrival_time=(p_payload->>'arrival_time')::time where property_id=p_property and id=entity;
   v:=v||jsonb_build_object('arrival_time',p_payload->>'arrival_time');
  end if;
  if p_action='reserve'and p_payload?'registration'then
   update public.bite_stays set register_number=(select coalesce(max(register_number),0)+1 from public.bite_stays where property_id=p_property),registration=(p_payload->'registration')||jsonb_build_object('registered_at',now())where id=entity;
   select v||jsonb_build_object('register_number',register_number)into v from public.bite_stays where id=entity;
  end if;
  if p_action='reserve'then
   update public.bite_folio_entries set account_note=left(trim(coalesce(p_payload->>'advance_account',pr.tax_profile->>'primary_account','')),80)where property_id=p_property and folio_id=fid and kind='advance';
  elsif p_action in('payment','payment_confirm','deposit_hold','refund','deposit_return')then
   update public.bite_folio_entries set account_note=left(trim(coalesce(p_payload->>'account_note',nullif(account_note,''),pr.tax_profile->>'primary_account','')),80)where property_id=p_property and id=entity;
  elsif p_action in('room_pos','room_post')and coalesce((pr.tax_profile->>'reviewed')::boolean,false)and nullif(pr.tax_profile->>'gstin','')is not null then
   update public.bite_folio_entries e set tax_rate=coalesce((pr.tax_profile->>'food_rate')::numeric,0),tax_amount=round(e.amount*coalesce((pr.tax_profile->>'food_rate')::numeric,0)/100,2)where e.property_id=p_property and (e.id=coalesce(nullif(v->>'entry_id','')::uuid,entity)or e.source_order_id=nullif(v->>'order_id','')::uuid)and e.kind='charge'and e.category='food';
  elsif p_action='checkout'and not coalesce((v->>'already_complete')::boolean,false)then
   select * into strict f from public.bite_folios where property_id=p_property and id=fid;
   cfg:=f.invoice_snapshot||jsonb_build_object('number',private.bite_next_invoice_number(p_property),'reverse_charge',false,'place_of_supply',left(coalesce(pr.tax_profile->>'gstin',''),2));
   cfg:=cfg#-'{stay,registration}';
   cfg:=jsonb_set(cfg,'{tax_profile}',coalesce(cfg->'tax_profile','{}'::jsonb)-'primary_account');
   cfg:=cfg||jsonb_build_object('entries',(select coalesce(jsonb_agg(e-'account_note'),'[]'::jsonb)from jsonb_array_elements(cfg->'entries')e));
   cfg:=cfg||jsonb_build_object('gst',private.bite_invoice_gst(cfg));
   cfg:=cfg||jsonb_build_object('splits',private.bite_split_invoice(cfg,f.payer_split));
   update public.bite_folios set invoice_number=cfg->>'number',invoice_snapshot=cfg where id=f.id;
   v:=v||jsonb_build_object('invoice',cfg);
  end if;
  if p_action='charge'then
   update public.bite_folio_entries set tax_rate=case when coalesce((pr.tax_profile->>'reviewed')::boolean,false)then coalesce((pr.tax_profile->>'incidental_rate')::numeric,0)else 0 end where id=entity and property_id=p_property;
  elsif p_action in('checkin','extend','apply_checkout_policy')then
   update public.bite_folio_entries e set tax_rate=case when e.policy_tag in('early_checkin','late_checkout')then coalesce((st_row.policy_snapshot->>'fee_tax_rate')::numeric,0)else st_row.room_tax_rate end from public.bite_folios bf join public.bite_stays st_row on st_row.id=bf.stay_id where bf.property_id=p_property and bf.id=fid and e.folio_id=bf.id and e.category='room'and e.kind='charge'and e.tax_rate is null;
  end if;
  update public.bite_property_commands set result=v where property_id=p_property and request_id=p_request;
 end if;
 if custom then
  v:=coalesce(v,jsonb_build_object('id',entity,'folio_id',fid,'confirmed',true));
  insert into public.bite_property_commands values(p_property,p_request,p_action,p_payload,v,auth.uid(),now());
  insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)values(p_property,auth.uid(),p_action,entity,p_request);
 end if;return v;
end$function$;

CREATE OR REPLACE FUNCTION private.bite_property_command(p_property uuid, p_action text, p_payload jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
 task public.bite_service_tasks;job public.bite_folio_refund_requests;cfg jsonb;q jsonb;v_until timestamptz;v_assignee uuid;v_entry uuid;v_key bigint;v_closing uuid;v_lock boolean;
 prop public.bite_properties; prior public.bite_property_commands;
 room public.bite_rooms; stay public.bite_stays; folio public.bite_folios; entry public.bite_folio_entries;
 caps text[]; cap text; role_name text; entity uuid; guest uuid; room_id uuid; folio_id uuid;
 v_expected_cash numeric(14,2);v_extension_rate numeric(14,2);amount numeric(14,2); tax numeric(14,2); rate numeric(6,3); total jsonb; result jsonb;
 v_arrival date; v_departure date; n integer; a integer; c integer; old_room uuid; kind text; stat text; desc_text text;
 invoice jsonb; rid uuid; order_id uuid; ord public.orders; unit jsonb;v_group uuid;group_stays jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Authenticated request ID and payload required' using errcode='42501'; end if;
 role_name:=private.bite_property_role(p_property);
 if role_name is null then raise exception 'Property access denied' using errcode='42501'; end if;
 cap:=case
  when p_action in ('config','member','policy_save','attach_outlet','outlet_application','outlet_application_edit') then 'manage_modules'
  when p_action in ('room_save','room_status','room_privacy') then 'housekeeping'
  when p_action='guest_save' then 'guest_register'
  when p_action in ('reserve','reserve_group','reservation_edit','checkin','move','extend','cancel','no_show') then 'reservations'
  when p_action in ('room_post','room_pos') then 'charge_to_room'
  when p_action='task_update' then case when exists(select 1 from public.bite_service_tasks where property_id=p_property and id=(p_payload->>'id')::uuid and kind='room_service') then 'room_service' else 'housekeeping' end
  when p_action='compliance_save' then 'guest_register'
  when p_action='pos_sale' then 'restaurant_pos'
  when p_action='close_shift' then 'reporting'
  when p_action='expense' then 'expenses'
  else 'folios' end;
 if not private.bite_can(p_property,cap) then raise exception 'Module or role does not permit this action' using errcode='42501'; end if;
 if role_name='accountant' then raise exception 'Read-only accounting access' using errcode='42501'; end if;
 if p_action in ('room_save','discount','reverse','refund','payment_confirm','payment_void','expense','split_bill','close_shift','late_checkout','apply_checkout_policy','refund_request','refund_update') and role_name not in ('owner','manager') then raise exception 'Owner or manager authorization required' using errcode='42501'; end if;
 -- One property's writes serialize: allocation, ledger writes, config disable and
 -- checkout cannot race. No locks on unrelated restaurant/payment workflows.
 select * into strict prop from public.bite_properties where id=p_property for update;
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details'; end if;
  return prior.result;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;
 if p_action in ('move','extend','reservation_edit','late_checkout') and exists(select 1 from public.bite_folios f join public.bite_stays s on s.id=f.stay_id where f.property_id=p_property and s.id=entity and s.status='in_house' and f.checkout_policy is not null) then raise exception 'Checkout terms already finalized; finish settlement before changing this stay';end if;

 if p_action in ('room_pos','pos_sale') then
  if coalesce(jsonb_typeof(p_payload->'items'),'')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 200 then raise exception 'Add 1 to 200 valid POS items';end if;
  for unit in select value from jsonb_array_elements(p_payload->'items') loop
   if length(trim(coalesce(unit->>'name',''))) not between 1 and 120 or (unit->>'quantity')::numeric is null or (unit->>'quantity')::numeric not between 0.01 and 9999 or (unit->>'quantity')::numeric<>round((unit->>'quantity')::numeric,2) or (unit->>'unit_price')::numeric is null or (unit->>'unit_price')::numeric not between 0 and 9999999999.99 or (unit->>'unit_price')::numeric<>round((unit->>'unit_price')::numeric,2) then raise exception 'POS item quantity and price must be finite positive/two-decimal amounts';end if;
  end loop;
 end if;
 if p_action='policy_save' then
  cfg:=p_payload->'policy';
  if cfg is null or not coalesce(private.bite_policy_valid(cfg),false) or nullif(p_payload->>'checkin_time','') is null or nullif(p_payload->>'checkout_time','') is null or p_payload->>'checkin_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_payload->>'checkout_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Review valid policy amounts, times and limits';end if;
  if coalesce((cfg->>'fee_tax_rate')::numeric,0)>0 and not coalesce((prop.tax_profile->>'reviewed')::boolean,false) then raise exception 'Review tax registration/rates before setting fee tax';end if;
  update public.bite_properties set hotel_policy=cfg,checkin_time=(p_payload->>'checkin_time')::time,checkout_time=(p_payload->>'checkout_time')::time,updated_at=now() where id=p_property;entity:=p_property;
 elsif p_action='late_checkout' then
  select * into strict stay from public.bite_stays where property_id=p_property and id=entity and status='in_house';
  if nullif(p_payload->>'until','') is null or p_payload->>'until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' then raise exception 'Select the India local checkout date and time';end if;
  v_until:=(p_payload->>'until')::timestamp at time zone prop.timezone;
  if v_until<coalesce(stay.standard_checkout_at,(stay.departure+prop.checkout_time) at time zone prop.timezone) or (v_until at time zone prop.timezone)::date<>stay.departure then raise exception 'Use Extend stay for another night; late checkout stays on the departure date';end if;
  if exists(select 1 from public.bite_stays s where s.property_id=p_property and s.room_id=stay.room_id and s.id<>stay.id and s.status in ('reserved','in_house') and s.arrival>=stay.departure and coalesce(s.scheduled_arrival_at,(s.arrival+prop.checkin_time) at time zone prop.timezone)<v_until+make_interval(mins=>coalesce((stay.policy_snapshot->>'turnover_minutes')::integer,30))) then raise exception 'Late checkout conflicts with an incoming booking and cleaning time';end if;
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Record the approved late checkout reason';end if;
  update public.bite_stays set expected_checkout_at=v_until,late_fee_waived=coalesce((p_payload->>'waive_fee')::boolean,false) where id=stay.id;
 elsif p_action='apply_checkout_policy' then
  select * into strict folio from public.bite_folios where property_id=p_property and id=(p_payload->>'folio_id')::uuid and status='open';
  select * into strict stay from public.bite_stays where id=folio.stay_id and status='in_house';folio_id:=folio.id;entity:=folio.id;
  if folio.checkout_policy is not null then result:=jsonb_build_object('id',folio.id,'folio_id',folio.id,'already_complete',true,'policy',folio.checkout_policy);
  else
   q:=private.bite_policy_quote(stay.id,now());
   if p_payload->>'quote_hash' is distinct from q->>'quote_hash' then raise exception 'Policy quote changed. Refresh and review it again';end if;
   if (q->>'early_credit')::numeric>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'discount','room','Reviewed unused-night credit',(q->>'early_credit')::numeric,(q->>'early_credit_tax')::numeric,auth.uid(),'early_checkout');end if;
   if (q->>'late_fee')::numeric>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'charge','room','Reviewed late checkout: '||(q->>'started_late_hours')||' started hours',(q->>'late_fee')::numeric,(q->>'late_tax')::numeric,auth.uid(),'late_checkout');end if;
   update public.bite_folios set checkout_policy=q where id=folio.id;
  end if;
 elsif p_action='task_update' then
  select * into strict task from public.bite_service_tasks where property_id=p_property and id=entity;
  if task.status in ('completed','cancelled') then raise exception 'Task is already finished';end if;
  if task.kind='cleaning' and role_name not in ('owner','manager','housekeeping') then raise exception 'Cleaning staff or manager required' using errcode='42501';end if;
  if task.kind='room_service' and not private.bite_can(p_property,'room_service') then raise exception 'Room service access required' using errcode='42501';end if;
  stat:=p_payload->>'status';v_assignee:=coalesce(nullif(p_payload->>'assigned_to','')::uuid,task.assigned_to);
  if nullif(p_payload->>'assigned_to','') is not null and role_name not in ('owner','manager') then raise exception 'Manager assigns staff' using errcode='42501';end if;
  if v_assignee is not null and not exists(select 1 from public.bite_property_members where property_id=p_property and user_id=v_assignee and active and (role in ('owner','manager') or role=case when task.kind='cleaning' then 'housekeeping' else 'cashier' end)) then raise exception 'Choose active staff from this department/property';end if;
  if task.assigned_to is not null and task.assigned_to<>auth.uid() and role_name not in ('owner','manager') then raise exception 'Task belongs to another staff member' using errcode='42501';end if;
  if stat='assigned' and task.status in ('requested','assigned') and v_assignee is not null then null;
  elsif stat='in_progress' and task.status in ('requested','assigned') then
   if task.kind='cleaning' and (select do_not_disturb from public.bite_rooms where id=task.room_id) then raise exception 'Do Not Disturb is active. Confirm guest permission first';end if;
   v_assignee:=coalesce(v_assignee,auth.uid());
  elsif stat='ready' and task.kind='room_service' and task.status='in_progress' then null;
  elsif stat='completed' and ((task.kind='cleaning' and task.status='in_progress') or (task.kind='room_service' and task.status='ready')) then null;
  else raise exception 'Invalid service task transition';end if;
  update public.bite_service_tasks set status=stat,assigned_to=v_assignee,note=left(coalesce(p_payload->>'note',task.note),250),updated_at=now() where id=task.id;
  if task.kind='cleaning' and stat='in_progress' then update public.bite_rooms set housekeeping='cleaning' where id=task.room_id;end if;
  if task.kind='cleaning' and stat='completed' then update public.bite_rooms set housekeeping='cleaning',cleaning_requested=false,status_note='Cleaning completed; supervisor inspection required' where id=task.room_id;end if;
 elsif p_action='refund_request' then
  folio_id:=(p_payload->>'folio_id')::uuid;
  select * into strict folio from public.bite_folios where property_id=p_property and id=folio_id and status='open';total:=private.bite_folio_totals(folio.id);
  if (p_payload->>'amount')::numeric<>round((p_payload->>'amount')::numeric,2) then raise exception 'Use a two-decimal refund amount';end if;
  amount:=(p_payload->>'amount')::numeric;
  if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) then raise exception 'Enter a finite two-decimal refund amount';end if;
  if amount>greatest(0,-(total->>'balance')::numeric)-coalesce((select sum(r.amount) from public.bite_folio_refund_requests r where r.folio_id=folio.id and r.status in ('requested','processing','failed')),0) then raise exception 'Refund requests exceed the remaining credit';end if;
  insert into public.bite_folio_refund_requests(property_id,folio_id,amount,method,reason,created_by)values(p_property,folio.id,amount,p_payload->>'method',trim(p_payload->>'reason'),auth.uid())returning id into entity;
 elsif p_action='refund_update' then
  select * into strict job from public.bite_folio_refund_requests where property_id=p_property and id=entity;
  if job.status in ('paid','cancelled') then raise exception 'Refund request already finished';end if;
  stat:=p_payload->>'status';folio_id:=job.folio_id;
  if stat='paid' then
   select * into strict folio from public.bite_folios where id=job.folio_id and status='open';total:=private.bite_folio_totals(folio.id);
   if job.amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Credit changed; review before recording the return';end if;
   if length(trim(coalesce(p_payload->>'reference','')))<3 or not coalesce((p_payload->>'return_verified')::boolean,false) then raise exception 'Verify the actual return and record its bank/receipt reference';end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,method,reference,created_by)values(p_property,folio.id,'refund','payment','Refund return recorded by property',job.amount,job.method,left(p_payload->>'reference',100),auth.uid())returning id into v_entry;
   update public.bite_folio_refund_requests set status='paid',entry_id=v_entry,reference=left(p_payload->>'reference',100),updated_at=now() where id=job.id;
  elsif stat in ('processing','failed','cancelled') then update public.bite_folio_refund_requests set status=stat,updated_at=now() where id=job.id;
  else raise exception 'Invalid refund progress';end if;
 elsif p_action='guest_link_revoke' then
  folio_id:=(p_payload->>'folio_id')::uuid;
  update public.bite_guest_folio_links l set revoked_at=now() where l.folio_id=(p_payload->>'folio_id')::uuid and l.property_id=p_property;
  entity:=folio_id;
 elsif p_action='compliance_save' then
  select * into strict stay from public.bite_stays where id=entity and property_id=p_property;
  if not exists(select 1 from public.bite_guests where id=stay.guest_id and (is_oci or lower(trim(country)) not in ('india','indian','bharat','भारत'))) then raise exception 'This checklist is for a foreign/OCI guest';end if;
  insert into public.bite_stay_compliance(stay_id,property_id,travel_document_checked,permission_checked,record_retained_externally,arrived_from,previous_stay,purpose,next_destination,arrival_reference,arrival_reported_at,departure_reference,departure_reported_at,updated_by)
  values(stay.id,p_property,coalesce((p_payload->>'travel_document_checked')::boolean,false),coalesce((p_payload->>'permission_checked')::boolean,false),coalesce((p_payload->>'record_retained_externally')::boolean,false),left(coalesce(p_payload->>'arrived_from',''),120),left(coalesce(p_payload->>'previous_stay',''),250),left(coalesce(p_payload->>'purpose',''),80),left(coalesce(p_payload->>'next_destination',''),250),left(coalesce(p_payload->>'arrival_reference',''),120),case when length(trim(coalesce(p_payload->>'arrival_reference','')))>0 then now()end,left(coalesce(p_payload->>'departure_reference',''),120),case when length(trim(coalesce(p_payload->>'departure_reference','')))>0 then now()end,auth.uid())
  on conflict(stay_id)do update set travel_document_checked=excluded.travel_document_checked,permission_checked=excluded.permission_checked,record_retained_externally=excluded.record_retained_externally,arrived_from=excluded.arrived_from,previous_stay=excluded.previous_stay,purpose=excluded.purpose,next_destination=excluded.next_destination,arrival_reference=excluded.arrival_reference,arrival_reported_at=case when bite_stay_compliance.arrival_reference=excluded.arrival_reference then bite_stay_compliance.arrival_reported_at else excluded.arrival_reported_at end,departure_reference=excluded.departure_reference,departure_reported_at=case when bite_stay_compliance.departure_reference=excluded.departure_reference then bite_stay_compliance.departure_reported_at else excluded.departure_reported_at end,updated_by=auth.uid(),updated_at=now();
 elsif p_action='attach_outlet' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not 'restaurant_menu'=any(prop.capabilities) then raise exception 'Enable Restaurant or Hybrid modules first';end if;
  if not public.has_restaurant_role(rid,array['owner']) or (select count(*) from public.restaurant_members where restaurant_id=rid and role='owner')<>1 or not exists(select 1 from public.restaurants where id=rid and status='Active' and onboarding_status='approved') then raise exception 'One verified owner and an approved active restaurant required' using errcode='42501';end if;
  if exists(select 1 from public.bite_property_outlets where restaurant_id=rid and property_id<>p_property) then raise exception 'This outlet is already assigned to another property';end if;
  insert into public.bite_property_outlets(property_id,restaurant_id)values(p_property,rid)on conflict do nothing;entity:=rid;
 elsif p_action='outlet_application' then
  if not 'restaurant_menu'=any(prop.capabilities) then raise exception 'Choose Restaurant or Hybrid business modules first';end if;
  if exists(select 1 from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property and r.onboarding_status in ('pending','rejected')) then raise exception 'Review the existing application before submitting another';end if;
  if (select count(*) from public.bite_properties where business_id=prop.business_id)>20 or (select count(*) from public.bite_outlet_applications where submitted_by=auth.uid())>=20 then raise exception 'Contact Bite to review additional outlets';end if;
  if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'city',''))) not between 1 and 100 or length(trim(coalesce(p_payload->>'address',''))) not between 3 and 500 or p_payload->>'phone' !~ '^[+0-9 ()-]{7,20}$' then raise exception 'Enter the actual restaurant name, city, address and contact phone';end if;
  rid:=gen_random_uuid();
  insert into public.bite_outlet_applications(restaurant_id,property_id,submitted_by)values(rid,p_property,auth.uid());
  insert into public.restaurants(id,name,city,address,phone,email,contact_person,status,onboarding_status,onboarding_submitted_at,is_published,created_by)
  values(rid,trim(p_payload->>'name'),trim(p_payload->>'city'),trim(p_payload->>'address'),trim(p_payload->>'phone'),(select email from auth.users where id=auth.uid()),left(coalesce(p_payload->>'contact_person',''),120),'Lead added','pending',now(),false,auth.uid());
  insert into public.restaurant_members(restaurant_id,user_id,role)values(rid,auth.uid(),'owner')on conflict do nothing;entity:=rid;
  result:=jsonb_build_object('id',rid,'status','pending','confirmed',true);
 elsif p_action='outlet_application_edit' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not exists(select 1 from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property and a.restaurant_id=rid and a.submitted_by=auth.uid() and r.onboarding_status in ('pending','rejected')) then raise exception 'Only your pending/rejected application can be edited' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'address',''))) not between 3 and 500 then raise exception 'Enter the requested name and full address';end if;
  if exists(select 1 from public.restaurant_change_requests where restaurant_id=rid and request_type='profile' and status='Pending') then raise exception 'An existing profile correction is awaiting Admin review';end if;
  insert into public.restaurant_change_requests(restaurant_id,requested_by,request_type,proposed_values)values(rid,auth.uid(),'profile',jsonb_build_object('name',trim(p_payload->>'name'),'address',trim(p_payload->>'address')))returning id into entity;
 elsif p_action='config' then
  select coalesce(array_agg(value),'{}'::text[]) into caps from jsonb_array_elements_text(p_payload->'capabilities');
  if caps is null or not caps <@ private.bite_default_capabilities('hybrid') then raise exception 'Unknown business module'; end if;
  if p_payload->>'business_type' not in ('restaurant','hotel','hybrid') then raise exception 'Choose a valid business type'; end if;
  if p_payload->>'business_type' in ('hotel','hybrid') and not 'hotel_rooms'=any(caps) then raise exception 'Hotel business type requires the hotel module bundle'; end if;
  if p_payload->>'business_type' in ('restaurant','hybrid') and not 'restaurant_menu'=any(caps) then raise exception 'Restaurant business type requires its menu module'; end if;
  if ('hotel_rooms'=any(caps)) <> ('folios'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('reservations'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('guest_register'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('housekeeping'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('hotel_incidentals'=any(caps)) then raise exception 'Hotel rooms, register, reservations, folios, housekeeping and incidentals must stay enabled together'; end if;
  if ('charge_to_room'=any(caps) or 'room_service'=any(caps)) and not (array['hotel_rooms','folios','restaurant_pos','restaurant_menu'] <@ caps) then raise exception 'Room service and room charging require hotel folios and restaurant POS/menu'; end if;
  if ('restaurant_pos'=any(caps) or 'online_food_orders'=any(caps)) and not 'restaurant_menu'=any(caps) then raise exception 'POS and online orders require Menu'; end if;
  if ('dine_in'=any(caps) or 'takeaway'=any(caps)) and not 'restaurant_pos'=any(caps) then raise exception 'Dine-in and takeaway require POS'; end if;
  if p_payload->>'business_type'='hotel' and caps && array['restaurant_pos','restaurant_menu','online_food_orders','dine_in','takeaway','room_service','charge_to_room'] then raise exception 'Hotel-only cannot enable restaurant modules'; end if;
  if p_payload->>'business_type'='restaurant' and 'hotel_rooms'=any(caps) then raise exception 'Choose Hybrid to add rooms to a restaurant'; end if;
  if 'hotel_rooms'=any(prop.capabilities) and not 'hotel_rooms'=any(caps) and
   (exists(select 1 from public.bite_stays where property_id=p_property and status in ('reserved','in_house')) or exists(select 1 from public.bite_folios f where f.property_id=p_property and (f.status='open' or (private.bite_folio_totals(f.id)->>'deposit_held')::numeric<>0))) then raise exception 'Active stays, reservations or unsettled folios prevent disabling hotel modules'; end if;
  if not array['restaurant_pos','restaurant_menu','online_food_orders'] <@ caps and exists(
   select 1 from public.bite_property_outlets o join public.orders r on r.restaurant_id=o.restaurant_id
   where o.property_id=p_property and not r.is_demo
   and (not 'restaurant_menu'=any(caps) or (not 'restaurant_pos'=any(caps) and r.channel like 'POS - %') or (not 'online_food_orders'=any(caps) and r.channel not like 'POS - %'))
   and (r.status in ('Received','Accepted','Preparing','Ready','Handed Over') or exists(select 1 from public.bite_refund_jobs j where j.order_id=r.id and j.status not in ('succeeded','cancelled')))) then raise exception 'Resolve active orders/refunds before disabling food modules'; end if;
  if 'restaurant_pos'=any(prop.capabilities) and not 'restaurant_pos'=any(caps) and exists(
   select 1 from public.bite_property_outlets o join public.restaurant_order_payment_summaries s on s.restaurant_id=o.restaurant_id
   where o.property_id=p_property and s.balance_amount>0) then raise exception 'Resolve unpaid POS balances before disabling POS'; end if;
  if 'online_food_orders'=any(prop.capabilities) and not 'online_food_orders'=any(caps) and exists(
   select 1 from public.bite_property_outlets o join public.bite_live_checkout_intents i on i.restaurant_id=o.restaurant_id
   where o.property_id=p_property and i.status not in ('expired','cancelled','failed','activated')) then raise exception 'Resolve pending online checkouts before disabling online ordering'; end if;
  if coalesce((p_payload->'tax_profile'->>'reviewed')::boolean,false) then
   if nullif(p_payload->'tax_profile'->>'gstin','') is not null and (p_payload->'tax_profile'->>'gstin') !~ '^[0-9]{2}[A-Z0-9]{13}$' then raise exception 'GSTIN format invalid'; end if;
   if coalesce((p_payload->'tax_profile'->>'room_rate')::numeric,0) not between 0 and 100 or coalesce((p_payload->'tax_profile'->>'incidental_rate')::numeric,0) not between 0 and 100 then raise exception 'Tax rate invalid'; end if;
  end if;
  update public.bite_properties set name=trim(p_payload->>'name'),business_type=p_payload->>'business_type',capabilities=caps,
   address=left(coalesce(p_payload->>'address',''),500),phone=left(coalesce(p_payload->>'phone',''),20),
   tax_profile=coalesce(p_payload->'tax_profile','{"reviewed":false}'::jsonb),updated_at=now() where id=p_property;
  entity:=p_property;
 elsif p_action='close_shift' then
  v_arrival:=(p_payload->>'shift_date')::date;v_lock:=coalesce((p_payload->>'lock_journals')::boolean,false);
  if v_arrival is null or v_arrival>(now() at time zone prop.timezone)::date then raise exception 'Choose a completed/current day';end if;
  select id into v_closing from public.bite_property_shift_closings where property_id=p_property and shift_date=v_arrival;
  if v_closing is not null and (not v_lock or (select locked from public.bite_property_shift_closings where id=v_closing)) then raise exception 'Closing already exists; review its saved snapshot';end if;
  if v_lock then
   for v_key in select distinct hashtextextended('bite.cashbook.day.v1|'||restaurant_id::text||'|'||v_arrival::text,0) from public.bite_property_outlets where property_id=p_property order by 1 loop perform pg_advisory_xact_lock(v_key);end loop;
   if exists(select 1 from public.bite_folio_entries where property_id=p_property and status='pending' and (created_at at time zone prop.timezone)::date=v_arrival) then raise exception 'Verify or void pending hotel receipts before locking the day';end if;
  end if;
  total:=private.bite_property_report(p_property,v_arrival,v_arrival);
  if p_payload->>'source_hash' is distinct from total->>'source_hash' then raise exception 'Ledger changed. Refresh and review before closing';end if;
  amount:=(p_payload->>'opening_cash')::numeric;tax:=(p_payload->>'counted_cash')::numeric;
  if amount is null or tax is null or amount not between 0 and 999999999999.99 or tax not between 0 and 999999999999.99 or amount<>round(amount,2) or tax<>round(tax,2) then raise exception 'Valid opening and counted cash required';end if;
  v_expected_cash:=amount+(total->>'cash_movement')::numeric;
  if v_expected_cash not between 0 and 999999999999.99 then raise exception 'Opening cash insufficient for cash outflows';end if;
  desc_text:=left(trim(coalesce(p_payload->>'notes','')),500);
  if tax<>v_expected_cash and length(desc_text)<8 then raise exception 'Explain the cash difference (at least 8 characters)';end if;
  if v_closing is null then
   insert into public.bite_property_shift_closings(property_id,shift_date,opening_cash,counted_cash,expected_cash,difference,notes,snapshot,created_by)
   values(p_property,v_arrival,amount,tax,v_expected_cash,tax-v_expected_cash,desc_text,total,auth.uid())returning id into v_closing;
  end if;
  if v_lock then update public.bite_property_shift_closings set locked=true,locked_at=now(),locked_by=auth.uid(),lock_review=total||jsonb_build_object('opening_cash',amount,'counted_cash',tax,'expected_cash',v_expected_cash,'difference',tax-v_expected_cash,'notes',desc_text) where id=v_closing;end if;
  entity:=v_closing;
 elsif p_action='pos_sale' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not exists(select 1 from public.bite_property_outlets where property_id=p_property and restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized POS outlet required' using errcode='42501';end if;
  if p_payload->>'channel' not in ('POS - Counter','POS - Dine-in','POS - Takeaway') then raise exception 'Select a POS order type';end if;
  select sum(round((value->>'quantity')::numeric*(value->>'unit_price')::numeric,2)) into amount from jsonb_array_elements(p_payload->'items');
  if (p_payload->>'paid_amount')::numeric is distinct from amount then raise exception 'Dine-in, takeaway and cashier Pay Now bills require full recorded payment. Use room billing for an occupied guest';end if;
  entity:=public.create_pos_order_with_payment(rid,'POS-'||p_request::text,p_payload->>'channel',left(p_payload->>'customer_name',120),left(p_payload->>'customer_phone',20),p_payload->'items',amount,p_payload->>'payment_method',(now() at time zone prop.timezone)::date,p_payload->>'reference',nullif(p_payload->>'table_id','')::uuid);
  result:=jsonb_build_object('id',entity,'order_id',entity,'order_code','POS-'||p_request::text,'confirmed',true);
 elsif p_action='expense' then
  if (p_payload->>'amount')::numeric<>round((p_payload->>'amount')::numeric,2) then raise exception 'Maximum two decimal places'; end if;
  insert into public.bite_property_expenses(property_id,description,amount,expense_date,method,created_by)
  values(p_property,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'expense_date')::date,p_payload->>'method',auth.uid()) returning id into entity;
 elsif p_action='member' then
  if entity is null then
   if (select count(*) from auth.users u where lower(u.email)=lower(trim(p_payload->>'email')))<>1 then raise exception 'Exactly one registered staff account must match this email'; end if;
   select u.id into entity from auth.users u where lower(u.email)=lower(trim(p_payload->>'email'));
  end if;
  if p_payload->>'role' not in ('manager','receptionist','cashier','housekeeping','accountant') then raise exception 'Choose a permitted staff role'; end if;
  if entity=(select owner_id from public.bite_businesses where id=prop.business_id) or exists(select 1 from public.platform_admins where user_id=entity) then raise exception 'Cannot reassign property owner or platform admin'; end if;
  if not exists(select 1 from auth.users where id=entity) then raise exception 'Registered user ID required'; end if;
  insert into public.bite_property_members values(p_property,entity,p_payload->>'role',coalesce((p_payload->>'active')::boolean,true))
   on conflict(property_id,user_id) do update set role=excluded.role,active=excluded.active;
 -- Link only explicitly assigned cashiers/managers to this owner's outlets.
  -- Existing independent memberships are never overwritten or removed.
  for rid in select restaurant_id from public.bite_property_outlets where property_id=p_property loop
   if not public.has_restaurant_role(rid,array['owner']) then raise exception 'Only the linked outlet owner may grant restaurant access' using errcode='42501';end if;
   if p_payload->>'role' in ('cashier','manager') and coalesce((p_payload->>'active')::boolean,true) then
    if not exists(select 1 from public.restaurant_members where restaurant_id=rid and user_id=entity) then
     insert into public.restaurant_members(restaurant_id,user_id,role) values(rid,entity,case when p_payload->>'role'='manager' then 'manager' else 'staff' end);
     insert into public.bite_cashier_outlet_grants(property_id,user_id,restaurant_id) values(p_property,entity,rid);
    end if;
   else
    delete from public.restaurant_members m where m.restaurant_id=rid and m.user_id=entity and m.role in ('staff','manager') and exists(select 1 from public.bite_cashier_outlet_grants g where g.property_id=p_property and g.restaurant_id=rid and g.user_id=entity);
    delete from public.bite_cashier_outlet_grants where property_id=p_property and restaurant_id=rid and user_id=entity;
   end if;
  end loop;
 elsif p_action='room_save' then
  if entity is null then
   insert into public.bite_rooms(property_id,number,room_type,floor,nightly_rate,adults,children)
   values(p_property,trim(p_payload->>'number'),trim(p_payload->>'room_type'),left(coalesce(p_payload->>'floor',''),30),(p_payload->>'nightly_rate')::numeric,(p_payload->>'adults')::integer,(p_payload->>'children')::integer) returning id into entity;
  else
   select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
   if exists(select 1 from public.bite_stays where room_id=entity and status in ('reserved','in_house')) and not coalesce((p_payload->>'active')::boolean,true) then raise exception 'Room has active or reserved stays'; end if;
   update public.bite_rooms set number=trim(p_payload->>'number'),room_type=trim(p_payload->>'room_type'),floor=left(coalesce(p_payload->>'floor',''),30),nightly_rate=case when p_payload?'nightly_rate'then(p_payload->>'nightly_rate')::numeric else nightly_rate end,adults=case when p_payload?'adults'then(p_payload->>'adults')::integer else adults end,children=case when p_payload?'children'then(p_payload->>'children')::integer else children end,active=coalesce((p_payload->>'active')::boolean,true) where id=entity;
  end if;
 elsif p_action='room_privacy' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  if not exists(select 1 from public.bite_stays where room_id=entity and status='in_house') and coalesce((p_payload->>'do_not_disturb')::boolean,false) then raise exception 'Do Not Disturb applies to occupied rooms';end if;
  if coalesce((p_payload->>'cleaning_requested')::boolean,false) then perform private.bite_ensure_cleaning(p_property,entity,(select id from public.bite_stays where room_id=entity and status='in_house' limit 1),coalesce(p_payload->>'note','Stayover cleaning'));end if;
  update public.bite_rooms set do_not_disturb=coalesce((p_payload->>'do_not_disturb')::boolean,false),cleaning_requested=coalesce((p_payload->>'cleaning_requested')::boolean,false),status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='room_status' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  stat:=p_payload->>'status';
  if room.do_not_disturb and stat in ('cleaning','ready') then raise exception 'Do Not Disturb is active. Confirm permission before starting cleaning';end if;
  if stat not in ('ready','dirty','cleaning','blocked') then raise exception 'Invalid room status'; end if;
  if stat='ready' and role_name='housekeeping' then raise exception 'Supervisor must inspect and mark Ready' using errcode='42501'; end if;
  if stat='blocked' and role_name not in ('owner','manager') then raise exception 'Manager must block rooms' using errcode='42501'; end if;
  if stat='blocked' and exists(select 1 from public.bite_stays where room_id=entity and status='in_house') then raise exception 'Move guest before blocking occupied room'; end if;
  if stat='ready' then update public.bite_service_tasks set status='completed',updated_at=now() where property_id=p_property and room_id=entity and kind='cleaning' and status not in ('completed','cancelled');end if;
  update public.bite_rooms set housekeeping=stat,cleaning_requested=case when stat='ready' then false else cleaning_requested end,status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='guest_save' then
  if entity is null then
   insert into public.bite_guests(property_id,full_name,phone,country,email,address,id_type,id_last4,is_oci)
   values(p_property,trim(p_payload->>'full_name'),trim(p_payload->>'phone'),coalesce(nullif(trim(p_payload->>'country'),''),'India'),left(coalesce(p_payload->>'email',''),120),left(coalesce(p_payload->>'address',''),500),coalesce(p_payload->>'id_type',''),coalesce(p_payload->>'id_last4',''),coalesce((p_payload->>'is_oci')::boolean,false)) returning id into entity;
  else
   update public.bite_guests set full_name=trim(p_payload->>'full_name'),phone=trim(p_payload->>'phone'),country=coalesce(nullif(trim(p_payload->>'country'),''),'India'),email=left(coalesce(p_payload->>'email',''),120),address=left(coalesce(p_payload->>'address',''),500),id_type=coalesce(p_payload->>'id_type',''),id_last4=coalesce(p_payload->>'id_last4',''),is_oci=coalesce((p_payload->>'is_oci')::boolean,is_oci) where id=entity and property_id=p_property;
   if not found then raise exception 'Guest not found'; end if;
  end if;
 elsif p_action='reserve_group' then
  if coalesce(jsonb_typeof(p_payload->'rooms'),'')<>'array' or jsonb_array_length(p_payload->'rooms') not between 1 and 50 then raise exception 'Choose 1 to 50 rooms for a group'; end if;
  insert into public.bite_booking_groups(property_id,name,payer_guest_id)
  values(p_property,trim(p_payload->>'name'),(p_payload->>'guest_id')::uuid) returning id into v_group;
  for unit in select value from jsonb_array_elements(p_payload->'rooms') loop
   result:=private.bite_property_command(p_property,'reserve',jsonb_build_object('guest_id',p_payload->>'guest_id','room_id',unit->>'room_id','adults',coalesce(unit->'adults','1'::jsonb),'children',coalesce(unit->'children','0'::jsonb),'arrival',p_payload->>'arrival','departure',p_payload->>'departure','compliance_note',coalesce(p_payload->>'compliance_note',''))||case when unit?'nightly_rate'then jsonb_build_object('nightly_rate',unit->'nightly_rate','terms_at_checkin',true)else '{}'::jsonb end,gen_random_uuid());
   update public.bite_stays set group_id=v_group where id=(result->>'id')::uuid;
   group_stays:=group_stays||jsonb_build_array(result);
  end loop;
  entity:=v_group;result:=jsonb_build_object('id',v_group,'stays',group_stays,'confirmed',true);
 elsif p_action='reserve' then
  guest:=(p_payload->>'guest_id')::uuid; room_id:=(p_payload->>'room_id')::uuid;
  v_arrival:=(p_payload->>'arrival')::date; v_departure:=(p_payload->>'departure')::date;
  a:=(p_payload->>'adults')::integer; c:=coalesce((p_payload->>'children')::integer,0);
  select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active;
  if v_arrival is null or v_departure is null or v_departure<=v_arrival or v_departure-v_arrival>365 then raise exception 'Choose valid stay dates (maximum 365 nights)'; end if;
  perform private.bite_check_room_timing(p_property,room.id,v_arrival,v_departure);
  if nullif(p_payload->>'quote_hash','') is not null then q:=private.bite_reservation_quote(p_property,p_payload||jsonb_build_object('mode',p_payload->>'booking_mode'));if p_payload->>'quote_hash'<>q->>'quote_hash' then raise exception 'Room quote changed. Review the current rates again';end if;end if;
  if room.housekeeping='blocked' then raise exception 'Room is blocked for maintenance'; end if;
  if a is null or a not between 1 and 20 or c is null or c not between 0 and 20 then raise exception 'Enter valid adult and child counts';end if;
  if not coalesce((p_payload->>'terms_at_checkin')::boolean,false)and(a>room.adults or c>room.children)then raise exception 'Room occupancy limit exceeded';end if;
  if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(v_arrival,v_departure,'[)')) then raise exception 'Room already reserved for these dates'; end if;
  amount:=coalesce((p_payload->>'nightly_rate')::numeric,room.nightly_rate);
  if amount is null or amount not between 0 and 9999999999.99 or amount<>round(amount,2)then raise exception 'Enter the agreed room rent at check-in';end if;
  if amount<>room.nightly_rate and role_name not in ('owner','manager')and not coalesce((p_payload->>'terms_at_checkin')::boolean,false)then raise exception 'Manager approval required for rate override' using errcode='42501'; end if;
  rate:=case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.tax_profile->>'room_rate')::numeric,0) else 0 end;
  cfg:=prop.hotel_policy||jsonb_build_object('terms_at_checkin',coalesce((p_payload->>'terms_at_checkin')::boolean,false),'checkin_time',prop.checkin_time,'checkout_time',prop.checkout_time,'fee_tax_rate',case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.hotel_policy->>'fee_tax_rate')::numeric,0) else 0 end);
  if p_payload->>'booking_source'='external_booking' and length(trim(coalesce(p_payload->>'booking_reference','')))<3 then raise exception 'Record the external booking reference';end if;
  insert into public.bite_stays(property_id,guest_id,room_id,arrival,departure,adults,children,nightly_rate,room_tax_rate,compliance_note,policy_snapshot,scheduled_arrival_at,standard_checkout_at,expected_checkout_at,booking_source,booking_reference)
  values(p_property,guest,room.id,v_arrival,v_departure,a,c,amount,rate,left(coalesce(p_payload->>'compliance_note',''),250),cfg,(v_arrival+prop.checkin_time) at time zone prop.timezone,(v_departure+prop.checkout_time) at time zone prop.timezone,(v_departure+prop.checkout_time) at time zone prop.timezone,coalesce(p_payload->>'booking_source','walk_in'),left(coalesce(p_payload->>'booking_reference',''),120))returning id into entity;
  insert into public.bite_folios(property_id,stay_id)values(p_property,entity)returning id into folio_id;
  if coalesce((p_payload->>'advance_amount')::numeric,0)<>0 then
   amount:=(p_payload->>'advance_amount')::numeric;
   if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or amount>(select s.nightly_rate from public.bite_stays s where s.id=entity)*(v_departure-v_arrival)*(1+rate/100) then raise exception 'Advance exceeds the current room quote or is invalid';end if;
   stat:=case when p_payload->>'advance_method' in ('UPI','Card','Bank Transfer') then 'pending' else 'confirmed' end;
   if coalesce((p_payload->>'advance_verified')::boolean,false) then
    if role_name not in ('owner','manager') or length(trim(coalesce(p_payload->>'advance_reference','')))<3 then raise exception 'Owner/manager bank verification and reference required' using errcode='42501';end if;stat:='confirmed';
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,method,reference,status,created_by)values(p_property,folio_id,'advance','payment','Recorded booking advance; external reference '||left(coalesce(p_payload->>'booking_reference',''),100),amount,p_payload->>'advance_method',left(coalesce(p_payload->>'advance_reference',''),100),stat,auth.uid());
  end if;
 elsif p_action in ('reservation_edit','checkin','move','extend','cancel','no_show') then
  select * into strict stay from public.bite_stays where id=entity and property_id=p_property;
  select * into strict folio from public.bite_folios where stay_id=stay.id and property_id=p_property;
  if folio.status<>'open' then raise exception 'Folio already settled'; end if;
  if p_action='reservation_edit' then
   if stay.status<>'reserved' then raise exception 'Only an unarrived reservation can be corrected'; end if;
   v_arrival:=(p_payload->>'arrival')::date;v_departure:=(p_payload->>'departure')::date;
   room_id:=(p_payload->>'room_id')::uuid;a:=(p_payload->>'adults')::integer;c:=(p_payload->>'children')::integer;
   if v_departure<=v_arrival or v_departure-v_arrival>365 then raise exception 'Choose valid stay dates'; end if;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping<>'blocked';
   if a is null or a not between 1 and 20 or c is null or c not between 0 and 20 then raise exception 'Enter valid adult and child counts';end if;
  if not (coalesce((p_payload->>'terms_at_checkin')::boolean,false)or coalesce((stay.policy_snapshot->>'terms_at_checkin')::boolean,false))and(a>room.adults or c>room.children)then raise exception 'Room occupancy limit exceeded';end if;
   if exists(select 1 from public.bite_stays s where s.id<>stay.id and s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(v_arrival,v_departure,'[)')) then raise exception 'Room already reserved for corrected dates'; end if;
   perform private.bite_check_room_timing(p_property,room.id,v_arrival,v_departure,stay.id);
   update public.bite_stays set scheduled_arrival_at=(v_arrival+coalesce((stay.policy_snapshot->>'checkin_time')::time,prop.checkin_time))at time zone prop.timezone,standard_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,expected_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,policy_snapshot=case when coalesce((p_payload->>'terms_at_checkin')::boolean,false)then policy_snapshot||'{"terms_at_checkin":true}'::jsonb else policy_snapshot end,room_id=room.id,arrival=v_arrival,departure=v_departure,adults=a,children=c where id=stay.id;
  elsif p_action='checkin' then
   if stay.status='in_house' then result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'already_complete',true);
   else
    if stay.status<>'reserved' then raise exception 'Reservation is not available for check-in'; end if;
    if stay.arrival>(now() at time zone prop.timezone)::date then raise exception 'Arrival date is in the future'; end if;
    if stay.departure<=(now() at time zone prop.timezone)::date then raise exception 'Update expired reservation dates before check-in'; end if;
    select * into strict room from public.bite_rooms where id=stay.room_id and property_id=p_property and active;
    if exists(select 1 from public.bite_stays pre where pre.room_id=room.id and pre.id<>stay.id and pre.status in ('reserved','in_house') and pre.departure=stay.arrival and coalesce(pre.expected_checkout_at,(pre.departure+prop.checkout_time)at time zone prop.timezone)>now()) then raise exception 'Resolve the earlier stay before early arrival';end if;
    if room.housekeeping<>'ready' or exists(select 1 from public.bite_stays where room_id=room.id and status='in_house') then raise exception 'Room is occupied or not inspected Ready'; end if;
    update public.bite_stays set status='in_house',checked_in_at=now() where id=stay.id;
    amount:=stay.nightly_rate*(stay.departure-stay.arrival); tax:=round(amount*stay.room_tax_rate/100,2);
    if amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,service_from,service_to,unit_rate) values(p_property,folio.id,'charge','room',(stay.departure-stay.arrival)||' nights · room '||room.number,amount,tax,auth.uid(),stay.arrival,stay.departure,stay.nightly_rate);end if;
    cfg:=stay.policy_snapshot;
    if coalesce((cfg->>'reviewed')::boolean,false) and now()<coalesce(stay.scheduled_arrival_at,(stay.arrival+prop.checkin_time)at time zone prop.timezone) and coalesce((cfg->>'early_checkin_fee')::numeric,0)>0 then
     amount:=(cfg->>'early_checkin_fee')::numeric;
     insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'charge','room','Reviewed early check-in fee',amount,round(amount*coalesce((cfg->>'fee_tax_rate')::numeric,0)/100,2),auth.uid(),'early_checkin');
    end if;
   end if;
  elsif p_action='move' then
   if stay.status not in ('reserved','in_house') then raise exception 'Only an active stay/reservation can move rooms'; end if;
   room_id:=(p_payload->>'room_id')::uuid;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping<>'blocked';
   perform private.bite_check_room_timing(p_property,room.id,stay.arrival,stay.departure,stay.id);
   if stay.status='in_house' and exists(select 1 from public.bite_stays where room_id=room.id and status='in_house') then raise exception 'Target room is occupied';end if;
   if stay.status='in_house' and room.housekeeping<>'ready' then raise exception 'Target room must be inspected Ready'; end if;
   if room.id=stay.room_id then raise exception 'Select another room'; end if;
   if not coalesce((stay.policy_snapshot->>'terms_at_checkin')::boolean,false)and(room.adults<stay.adults or room.children<stay.children)then raise exception 'Room occupancy limit exceeded'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.arrival,stay.departure,'[)')) then raise exception 'Target room has conflicting stay'; end if;
   if stay.status='in_house' then
    update public.bite_service_tasks set room_id=room.id,updated_at=now() where property_id=p_property and stay_id=stay.id and kind='cleaning' and status not in ('completed','cancelled');
    perform private.bite_ensure_cleaning(p_property,stay.room_id,null,'Room move: clean and inspect');
    update public.bite_rooms d set do_not_disturb=o.do_not_disturb,cleaning_requested=o.cleaning_requested from public.bite_rooms o where d.id=room.id and o.id=stay.room_id;
    update public.bite_rooms set housekeeping='dirty',do_not_disturb=false,cleaning_requested=false where id=stay.room_id;
   end if;
   update public.bite_stays set room_id=room.id where id=stay.id;
  elsif p_action='extend' then
   if stay.status not in ('reserved','in_house') then raise exception 'Stay cannot be extended'; end if;
   v_departure:=(p_payload->>'departure')::date; n:=v_departure-stay.departure;
   if n<=0 or v_departure-stay.arrival>365 then raise exception 'Choose a later departure date'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=stay.room_id and s.id<>stay.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.departure,v_departure,'[)')) then raise exception 'Extension conflicts with another reservation'; end if;
   amount:=coalesce((p_payload->>'nightly_rate')::numeric,stay.nightly_rate);
   if amount<>stay.nightly_rate and (role_name not in ('owner','manager') or stay.status<>'in_house') then raise exception 'Manager authorization and an in-house stay required for a new extension rate' using errcode='42501';end if;
   if amount<0 or amount<>round(amount,2) then raise exception 'Valid extension rate required';end if;
   v_extension_rate:=amount;amount:=v_extension_rate*n;
   if stay.status='in_house' and amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,service_from,service_to,unit_rate) values(p_property,folio.id,'charge','room',n||' extra nights',amount,round(amount*stay.room_tax_rate/100,2),auth.uid(),stay.departure,v_departure,v_extension_rate); end if;
   update public.bite_stays set departure=v_departure,nightly_rate=v_extension_rate,standard_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,expected_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,late_fee_waived=false where id=stay.id;
  else
   if stay.status<>'reserved' then raise exception 'Only an unarrived reservation can be cancelled/no-show'; end if;
   if p_action='no_show' and (stay.arrival>(now() at time zone prop.timezone)::date or (stay.arrival=(now() at time zone prop.timezone)::date and (now() at time zone prop.timezone)::time<prop.checkin_time)) then raise exception 'No-show cannot be marked before the arrival cutoff'; end if;
   total:=private.bite_folio_totals(folio.id);
   if (total->>'paid')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 or (total->>'balance')::numeric<>0 then raise exception 'Resolve advance, deposit and balance before cancellation'; end if;
   update public.bite_stays set status=case when p_action='cancel' then 'cancelled' else 'no_show' end where id=stay.id;
   update public.bite_folios set status='settled',settled_at=now() where id=folio.id;
  end if;
  folio_id:=folio.id;
 else
  folio_id:=(p_payload->>'folio_id')::uuid;
  select * into strict folio from public.bite_folios where id=folio_id and property_id=p_property;
  select * into strict stay from public.bite_stays where id=folio.stay_id and property_id=p_property;
  if folio.status='settled' then
   if p_action='checkout' then return jsonb_build_object('id',stay.id,'folio_id',folio.id,'already_complete',true,'invoice',folio.invoice_snapshot); end if;
   raise exception 'Settled folio is immutable';
  end if;
  total:=private.bite_folio_totals(folio.id);
  amount:=round((p_payload->>'amount')::numeric,2); desc_text:=left(trim(coalesce(p_payload->>'description','')),250);
  if p_action='split_bill' then
   if length(trim(coalesce(p_payload->>'first_name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'second_name',''))) not between 1 and 120 or coalesce((p_payload->>'first_percent')::numeric,0) not between 0.01 and 99.99 then raise exception 'Two payer names and a percentage between 0.01 and 99.99 required';end if;
   update public.bite_folios set payer_split=jsonb_build_object('first_name',trim(p_payload->>'first_name'),'second_name',trim(p_payload->>'second_name'),'first_percent',(p_payload->>'first_percent')::numeric) where id=folio.id;
   entity:=folio.id;
  elsif p_action='checkout' then
   if stay.status<>'in_house' then raise exception 'Only an in-house stay can check out'; end if;
   if exists(select 1 from public.bite_service_tasks where stay_id=stay.id and kind='room_service' and status not in ('completed','cancelled')) then raise exception 'Complete or reverse outstanding room-service orders before checkout';end if;
   if exists(select 1 from public.bite_folio_refund_requests where folio_id=folio.id and status in ('requested','processing','failed')) then raise exception 'Resolve the outstanding hotel refund request before checkout';end if;
   if folio.checkout_policy is null and coalesce((stay.policy_snapshot->>'reviewed')::boolean,false) then q:=private.bite_policy_quote(stay.id,now());if (q->>'early_credit')::numeric>0 or (q->>'late_fee')::numeric>0 then raise exception 'Review and apply the agreed checkout policy first';end if;update public.bite_folios set checkout_policy=q where id=folio.id;end if;
   if (total->>'balance')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;
   invoice:=jsonb_build_object('number','BITE-'||replace(folio.id::text,'-',''),'issued_at',now(),'property',jsonb_build_object('name',prop.name,'address',prop.address,'phone',prop.phone),'tax_profile',prop.tax_profile,
    'guest',(select jsonb_build_object('name',full_name,'address',address) from public.bite_guests where id=stay.guest_id),'stay',to_jsonb(stay)||jsonb_build_object('status','checked_out','checked_out_at',now()),'room',(select jsonb_build_object('number',number,'room_type',room_type) from public.bite_rooms where id=stay.room_id),'totals',total,
    'entries',(select coalesce(jsonb_agg((to_jsonb(e)-'created_by')||jsonb_build_object('source_items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.item_name,'quantity',i.quantity,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=e.source_order_id)) order by e.created_at),'[]'::jsonb) from public.bite_folio_entries e where e.folio_id=folio.id));
   invoice:=invoice||jsonb_build_object('splits',private.bite_split_invoice(invoice,folio.payer_split));
   update public.bite_folios set status='settled',settled_at=now(),invoice_number=invoice->>'number',invoice_snapshot=invoice where id=folio.id;
   update public.bite_stays set status='checked_out',checked_out_at=now() where id=stay.id;
   update public.bite_rooms set housekeeping='dirty',do_not_disturb=false,cleaning_requested=false where id=stay.room_id;
   update public.bite_service_tasks set status='cancelled',updated_at=now() where stay_id=stay.id and kind='cleaning' and status not in ('completed','cancelled');
   perform private.bite_ensure_cleaning(p_property,stay.room_id,null,'Checkout: clean and inspect');
   entity:=stay.id; result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'invoice',invoice);
  elsif p_action in ('payment_confirm','payment_void') then
   select * into strict entry from public.bite_folio_entries where id=entity and folio_id=folio.id and property_id=p_property;
   if entry.kind not in ('payment','advance','deposit_hold') or entry.status<>'pending' then raise exception 'Only pending payments or deposits can be verified'; end if;
   if p_action='payment_void' then
    if desc_text='' then raise exception 'Reason for not-received payment required'; end if;
    update public.bite_folio_entries set status='void',reference=left('Not received: '||desc_text,100) where id=entry.id;
   else
   if entry.kind='payment' and entry.amount>(total->>'balance')::numeric then raise exception 'Payment exceeds current balance'; end if;
   if length(trim(coalesce(p_payload->>'reference','')))=0 then raise exception 'Verified bank/provider reference required'; end if;
   update public.bite_folio_entries set status='confirmed',reference=left(p_payload->>'reference',100) where id=entry.id;
   end if;
  elsif p_action in ('room_post','room_pos') then
   if stay.status<>'in_house' then raise exception 'Select an occupied guest stay'; end if;
   if p_action='room_pos' then
    rid:=(p_payload->>'restaurant_id')::uuid;
    if not private.bite_can(p_property,'restaurant_pos') or not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized property POS outlet required' using errcode='42501'; end if;
    -- Reuse the existing POS engine. The whole sale + folio posting is one
    -- transaction, no restaurant cash receipt and no duplicate Khata debtor.
    order_id:=public.create_pos_order_with_payment(rid,'POS-ROOM-'||p_request::text,coalesce(p_payload->>'channel','POS - Counter'),
     (select full_name from public.bite_guests where id=stay.guest_id),'',p_payload->'items',0,null,current_date,null,null);
   amount:=coalesce((p_payload->>'discount')::numeric,0);
    if amount not between 0 and 999999999999.99 or amount<>round(amount,2) then raise exception 'Valid discount required';end if;
    if amount>0 then
     if role_name not in ('owner','manager') or length(trim(coalesce(p_payload->>'discount_reason','')))<3 then raise exception 'Manager approval and discount reason required' using errcode='42501';end if;
     if amount>=(select o.amount from public.orders o where o.id=order_id) then raise exception 'Discount must leave a positive food charge';end if;
     -- The matching folio proof is inserted before the coordinated update below.
    end if;
   else order_id:=(p_payload->>'order_id')::uuid; end if;
   select * into strict ord from public.orders where id=order_id for update;
   if not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=ord.restaurant_id) or not public.has_restaurant_role(ord.restaurant_id,array['owner','manager','staff']) then raise exception 'Order belongs to another property/outlet' using errcode='42501'; end if;
   if ord.channel not like 'POS - %' or ord.status in ('Cancelled','Rejected') or ord.is_demo then raise exception 'Only genuine POS sales can be charged to room'; end if;
   if ord.restaurant_customer_id is not null or (ord.waived_off_amount<>0 and p_action<>'room_pos') or exists(select 1 from public.restaurant_order_payments where order_id=ord.id) or exists(select 1 from public.restaurant_order_refunds where order_id=ord.id) then raise exception 'Paid, Khata-linked, adjusted or refunded POS sale cannot be posted'; end if;
   if exists(select 1 from public.bite_folio_entries where source_order_id=ord.id) then raise exception 'POS sale already posted to a folio'; end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,source_order_id,created_by)
   values(p_property,folio.id,'charge','food','POS '||ord.order_code||case when p_action='room_pos' and coalesce((p_payload->>'discount')::numeric,0)>0 then ' · discount '||(p_payload->>'discount')||': '||left(p_payload->>'discount_reason',60) else '' end,ord.amount-case when p_action='room_pos' then coalesce((p_payload->>'discount')::numeric,0) else 0 end,ord.id,auth.uid()) returning id into entity;
   if p_action='room_pos' and coalesce((p_payload->>'discount')::numeric,0)>0 then update public.orders set waived_off_amount=(p_payload->>'discount')::numeric where id=ord.id;end if;
   if p_action='room_pos' and p_payload->>'fulfilment'='room_service' then
    if not private.bite_can(p_property,'room_service') then raise exception 'Room service disabled' using errcode='42501';end if;
    insert into public.bite_service_tasks(property_id,kind,room_id,stay_id,order_id,note,created_by)values(p_property,'room_service',stay.room_id,stay.id,ord.id,left(coalesce(p_payload->>'service_note',''),250),auth.uid());
   end if;
   if p_action='room_pos' then result:=jsonb_build_object('id',ord.id,'order_id',ord.id,'entry_id',entity,'folio_id',folio.id,'confirmed',true); end if;
  elsif p_action='reverse' then
   select * into strict entry from public.bite_folio_entries where id=entity and folio_id=folio.id and property_id=p_property and kind='charge' and status='confirmed';
   if desc_text='' then raise exception 'Reversal reason required'; end if;
   if entry.source_order_id is not null then
    if not private.bite_can(p_property,'charge_to_room') then raise exception 'Room charge correction permission required' using errcode='42501'; end if;
    select * into strict ord from public.orders where id=entry.source_order_id for update;
    if not public.has_restaurant_role(ord.restaurant_id,array['owner','manager']) then raise exception 'Restaurant manager permission required' using errcode='42501'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,reversal_of,created_by)
   values(p_property,folio.id,'reversal',entry.category,desc_text,entry.amount,entry.tax_amount,entry.id,auth.uid()) returning id into entity;
   if entry.source_order_id is not null then
    -- The trigger below permits only this coordinated cancellation, once the
    -- immutable matching reversal exists in the same transaction.
    update public.orders set status='Cancelled' where id=entry.source_order_id;
    update public.bite_service_tasks set status='cancelled',updated_at=now() where order_id=entry.source_order_id and kind='room_service';
   end if;
  elsif p_action in ('charge','discount','payment','refund','deposit_hold','deposit_return','deposit_apply') then
   if amount is null or amount<=0 or (p_payload->>'amount')::numeric<>amount then raise exception 'Positive amount with maximum two decimals required'; end if;
   if desc_text='' then raise exception 'Description or reason required'; end if;
   kind:=p_action; tax:=0; stat:='confirmed';
   if p_action='charge' then
    if stay.status<>'in_house' or not private.bite_can(p_property,'hotel_incidentals') then raise exception 'Active stay and incidentals permission required'; end if;
    rate:=case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.tax_profile->>'incidental_rate')::numeric,0) else 0 end;
    tax:=round(amount*rate/100,2);
   elsif p_action in ('payment','deposit_hold') then
    if p_payload->>'method' not in ('Cash','UPI','Card','Bank Transfer','Other') then raise exception 'Select collection method'; end if;
    stat:=case when p_payload->>'method' in ('UPI','Card','Bank Transfer') then 'pending' else 'confirmed' end;
    if p_action='payment' then
     if stay.status='reserved' then
      if amount>round(stay.nightly_rate*(stay.departure-stay.arrival)*(1+stay.room_tax_rate/100),2)-(total->>'paid')::numeric-(total->>'pending')::numeric then raise exception 'Advance exceeds current room quote'; end if;
      kind:='advance';
     elsif amount>(total->>'balance')::numeric then raise exception 'Payment exceeds outstanding balance'; end if;
    end if;
   elsif p_action in ('deposit_return','deposit_apply') then
    if amount>(total->>'deposit_held')::numeric then raise exception 'Amount exceeds held deposit'; end if;
    if p_action='deposit_apply' and amount>(total->>'balance')::numeric then raise exception 'Applied deposit exceeds balance'; end if;
   elsif p_action='discount' then
    if amount>(total->>'balance')::numeric then raise exception 'Discount exceeds outstanding balance'; end if;
   elsif p_action='refund' then
    if exists(select 1 from public.bite_folio_refund_requests where folio_id=folio.id and status in ('requested','processing','failed')) then raise exception 'Use the existing refund request to record this return';end if;
    if amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Only existing overpayment/credit can be recorded as refunded'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,status,method,reference,created_by)
   values(p_property,folio.id,kind,case when kind in ('deposit_hold','deposit_return','deposit_apply') then 'deposit' when kind in ('payment','advance','refund') then 'payment' else case when kind='discount' and p_payload->>'category'='room' then 'room' else 'incidental' end end,desc_text,amount,tax,stat,p_payload->>'method',left(coalesce(p_payload->>'reference',''),100),auth.uid()) returning id into entity;
  else raise exception 'Unknown property action'; end if;
 end if;
 result:=coalesce(result,jsonb_build_object('id',entity,'folio_id',folio_id,'confirmed',true));
 insert into public.bite_property_commands values(p_property,p_request,p_action,p_payload,result,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),p_action,entity,p_request);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.bite_reservation_quote(p_property uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr public.bite_properties;r public.bite_rooms;prior public.bite_stays;a date;d date;rate numeric;nightly numeric;total numeric;early numeric:=0;fee_tax numeric;cfg jsonb;v jsonb;ignored uuid;begin
 if not private.bite_can(p_property,'reservations') then raise exception 'Reservation access denied' using errcode='42501';end if;
 select * into strict pr from public.bite_properties where id=p_property;
 select * into strict r from public.bite_rooms where id=(p_details->>'room_id')::uuid and property_id=p_property and active;
 ignored:=nullif(p_details->>'stay_id','')::uuid;
 if ignored is not null then select * into strict prior from public.bite_stays where id=ignored and property_id=p_property and status='reserved';end if;
 cfg:=case when ignored is null then pr.hotel_policy else prior.policy_snapshot end;
 a:=(p_details->>'arrival')::date;d:=(p_details->>'departure')::date;
 if a is null or d is null or d<=a or d-a>365 or coalesce((p_details->>'adults')::integer,0) not between 1 and (case when coalesce((p_details->>'terms_at_checkin')::boolean,false)or coalesce((prior.policy_snapshot->>'terms_at_checkin')::boolean,false)then 20 else coalesce(r.adults,20)end) or coalesce((p_details->>'children')::integer,0) not between 0 and (case when coalesce((p_details->>'terms_at_checkin')::boolean,false)or coalesce((prior.policy_snapshot->>'terms_at_checkin')::boolean,false)then 20 else coalesce(r.children,20)end) then raise exception 'Check stay dates and room occupancy';end if;
 if r.housekeeping='blocked' or exists(select 1 from public.bite_stays where room_id=r.id and id is distinct from ignored and status in ('reserved','in_house') and daterange(arrival,departure,'[)')&&daterange(a,d,'[)')) then raise exception 'Room unavailable for these dates';end if;
 perform private.bite_check_room_timing(p_property,r.id,a,d,ignored);
 if p_details->>'mode'='checkin' then
  if r.housekeeping<>'ready' or exists(select 1 from public.bite_stays where room_id=r.id and id is distinct from ignored and status='in_house') then raise exception 'Room is not inspected Ready for arrival';end if;
  if coalesce((cfg->>'reviewed')::boolean,false) and now()<(a+coalesce((cfg->>'checkin_time')::time,pr.checkin_time)) at time zone pr.timezone then early:=coalesce((cfg->>'early_checkin_fee')::numeric,0);end if;
 end if;
 rate:=case when ignored is not null then prior.room_tax_rate when coalesce((pr.tax_profile->>'reviewed')::boolean,false) then coalesce((pr.tax_profile->>'room_rate')::numeric,0) else 0 end;
 nightly:=case when ignored is not null then prior.nightly_rate else coalesce((p_details->>'nightly_rate')::numeric,r.nightly_rate) end;
 if nightly is null or nightly not between 0 and 9999999999.99 or nightly<>round(nightly,2) then raise exception 'Enter a valid agreed nightly rent';end if;
 if ignored is null and nightly<>r.nightly_rate and private.bite_property_role(p_property) not in ('owner','manager')and not coalesce((p_details->>'terms_at_checkin')::boolean,false)then raise exception 'Manager approval required for rent override' using errcode='42501';end if;
 fee_tax:=case when ignored is not null or coalesce((pr.tax_profile->>'reviewed')::boolean,false) then coalesce((cfg->>'fee_tax_rate')::numeric,0) else 0 end;
 total:=nightly*(d-a);
 v:=jsonb_build_object('room',total,'room_tax',round(total*rate/100,2),'early_fee',early,'early_tax',round(early*fee_tax/100,2),'total',total+round(total*rate/100,2)+early+round(early*fee_tax/100,2),'nightly_rate',nightly,'policy',cfg);
 return v||jsonb_build_object('quote_hash',md5(v::text));
end $function$;
notify pgrst,'reload schema';
commit;
