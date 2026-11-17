-- Foreign register fields and race-safe reconciliation of check-in attempts. Apply after hotel_checkin_guest_flow.sql.
begin;
do $preflight$begin
 if md5(pg_get_functiondef('private.bite_hotel_account_command(uuid,text,jsonb,uuid)'::regprocedure))not in('020b9c1404d3323a0df5cc5f56f0dd5f','ca329856a6a2d6a28d03808fff77e3a7')then raise exception 'Function changed since review: private.bite_hotel_account_command(uuid,text,jsonb,uuid)';end if;
 if md5(pg_get_functiondef('private.bite_hotel_workspace(uuid)'::regprocedure))not in('d884fad81ad413ee03490c3650c46c54','e7000c4ceb5a36f060099f56288f413f')then raise exception 'Function changed since review: private.bite_hotel_workspace(uuid)';end if;
end$preflight$;
create or replace function private.bite_validate_foreign_details(v jsonb,arrival date,pre text default 'foreign_')returns void
language plpgsql immutable set search_path='' as $foreign$
declare k text;value text;d date;field_name text;begin
 if jsonb_typeof(v)is distinct from 'object'then raise exception 'Enter the foreign guest details'using errcode='22023';end if;
 foreach k in array array['nationality','date_of_birth','document_type','document_last4','document_expiry','visa_status','india_arrival','entry_port','purpose']loop
  if k='document_expiry'and v->>'document_type'='travel_document'and coalesce((v->>'document_no_expiry')::boolean,false)then continue;end if;
  value:=trim(coalesce(v->>k,''));field_name:=case when k='nationality'and pre='foreign_'then'country'else pre||k end;
  if length(value)not between 1 and (case when k in('nationality')then 60 else 120 end)then raise exception 'Complete the foreign guest details'using errcode='22023',detail=jsonb_build_object('field',field_name)::text;end if;
 end loop;
 if lower(trim(v->>'nationality'))in('india','indian','bharat','भारत')then raise exception 'Choose the foreign nationality / country'using errcode='22023',detail=jsonb_build_object('field',case when pre='foreign_'then'country'else pre||'nationality'end)::text;end if;
 if v->>'document_type'not in('passport','travel_document')or v->>'document_last4'!~'^[A-Za-z0-9]{4}$'then raise exception 'Enter only the last 4 travel document characters'using errcode='22023',detail=jsonb_build_object('field',pre||'document_last4')::text;end if;
 if v->>'visa_status'not in('visa','oci','exempt')then raise exception 'Choose visa, OCI or visa exempt'using errcode='22023',detail=jsonb_build_object('field',pre||'visa_status')::text;end if;
 if v->>'visa_status'<>'exempt'and coalesce(v->>'permission_last4','')!~'^[A-Za-z0-9]{4}$'then raise exception 'Enter the last 4 visa / OCI characters'using errcode='22023',detail=jsonb_build_object('field',pre||'permission_last4')::text;end if;
 foreach k in array array['date_of_birth','document_expiry','india_arrival','visa_expiry']loop
  if k='visa_expiry'and v->>'visa_status'<>'visa'then continue;end if;
  if k='document_expiry'and v->>'document_type'='travel_document'and coalesce((v->>'document_no_expiry')::boolean,false)then continue;end if;
  value:=coalesce(v->>k,'');field_name:=pre||k;
  begin
   if value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then raise invalid_datetime_format;end if;d:=value::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Enter a valid foreign guest date'using errcode='22023',detail=jsonb_build_object('field',field_name)::text;
  end;
  if(k in('date_of_birth','india_arrival')and d>arrival)or(k in('document_expiry','visa_expiry')and d<arrival)then raise exception 'Recheck the foreign guest document and travel dates'using errcode='22023',detail=jsonb_build_object('field',field_name)::text;end if;
 end loop;
end$foreign$;
revoke all on function private.bite_validate_foreign_details(jsonb,date,text)from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.bite_hotel_account_command(p_property uuid, p_action text, p_payload jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr public.bite_properties;prior public.bite_property_commands;role_name text;v jsonb;cfg jsonb;t jsonb;s public.bite_stays;f public.bite_folios;series public.bite_invoice_series;
 entity uuid;fid uuid;amount numeric;d date;k text;custom boolean:=false;party_item jsonb;party jsonb;target public.bite_property_commands;begin
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
 if p_action='abandon_checkin'then
  custom:=true;
  if not private.bite_can(p_property,'reservations')or entity is null or entity=p_request then raise exception 'Check-in attempt access denied'using errcode='42501';end if;
  select * into target from public.bite_property_commands where property_id=p_property and request_id=entity;
  if found then
   if target.created_by<>auth.uid()or target.action not in('guest_save','reserve','checkin','abandoned_checkin')then raise exception 'This is not your check-in attempt'using errcode='42501';end if;
   if target.action='abandoned_checkin'then v:=jsonb_build_object('cancelled',true);
   else v:=jsonb_build_object('found',true,'action',target.action,'id',target.result->'id','folio_id',target.result->'folio_id');end if;
  else
   insert into public.bite_property_commands values(p_property,entity,'abandoned_checkin','{}','{"cancelled":true}',auth.uid(),now());
   v:=jsonb_build_object('cancelled',true);
  end if;
 elsif p_action='billing_settings'then
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
   if cfg?'foreign_details'then
    perform private.bite_validate_foreign_details(cfg->'foreign_details',(p_payload->>'arrival')::date);
    if not exists(select 1 from public.bite_guests where property_id=p_property and id=(p_payload->>'guest_id')::uuid and lower(trim(country))=lower(trim(cfg->'foreign_details'->>'nationality')))then raise exception 'Foreign nationality does not match the guest profile'using errcode='22023',detail='{"field":"country"}';end if;
   elsif cfg->>'flow_version'='2'and exists(select 1 from public.bite_guests where property_id=p_property and id=(p_payload->>'guest_id')::uuid and(is_oci or lower(trim(country))not in('india','indian','bharat','भारत')))then raise exception 'Open Foreign / OCI guest and complete the details'using errcode='22023',detail='{"field":"country"}';end if;
   if length(trim(coalesce(cfg->>'arrived_from','')))not between 1 and 120 or length(trim(coalesce(cfg->>'next_destination','')))not between 1 and 120 or cfg->>'transport'is null or cfg->>'transport'not in('Car','Bike','Bus','Train','Other')or(cfg->>'transport'in('Car','Bike')and length(trim(coalesce(cfg->>'vehicle_number','')))<4)then raise exception 'Enter arrival place, destination and vehicle details';end if;
   if not exists(select 1 from public.bite_guests where property_id=p_property and id=(p_payload->>'guest_id')::uuid and length(trim(address))>0)then raise exception 'Permanent address is required';end if;
   if not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=nullif(cfg->>'id_front','')::uuid and kind='masked_id'and status='ready'and subject_key is null)then raise exception 'Upload the ID front before confirming check-in';end if;
   party:=coalesce(cfg->'additional_ids','[]'::jsonb);
   if jsonb_typeof(party)is distinct from 'array'then raise exception 'Check the additional guest IDs'using errcode='22023';end if;
   if jsonb_array_length(party)>(p_payload->>'adults')::integer+coalesce((p_payload->>'children')::integer,0)-1 or jsonb_array_length(party)>39 then raise exception 'Additional IDs exceed the number of guests'using errcode='22023';end if;
   if (select count(distinct x->>'subject_key')from jsonb_array_elements(party)x)<>jsonb_array_length(party)then raise exception 'Each guest ID needs its own person reference'using errcode='22023';end if;
   for party_item in select value from jsonb_array_elements(party)loop
    if party_item?'foreign_details'then perform private.bite_validate_foreign_details(party_item->'foreign_details',(p_payload->>'arrival')::date,'party_'||(party_item->>'subject_key')||'_foreign_');end if;
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

CREATE OR REPLACE FUNCTION private.bite_hotel_workspace(p_property uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;begin
 v:=private.bite_hotel_workspace_before_remaining(p_property);
 v:=v||jsonb_build_object('tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('name',item_name,'quantity',quantity)),'[]'::jsonb) from public.order_items where order_id=t.order_id))order by t.created_at),'[]'::jsonb) from public.bite_service_tasks t where t.property_id=p_property and ((t.kind='cleaning' and private.bite_can(p_property,'housekeeping')) or (t.kind='room_service' and private.bite_can(p_property,'room_service')))));
 if private.bite_can(p_property,'housekeeping') or private.bite_can(p_property,'room_service') then v:=v||jsonb_build_object('task_members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),m.role||' account'))),'[]'::jsonb) from public.bite_property_members m join auth.users u on u.id=m.user_id where m.property_id=p_property and m.active and m.role in ('owner','manager','housekeeping','cashier')));end if;
 if private.bite_can(p_property,'folios') then v:=v||jsonb_build_object('refund_requests',(select coalesce(jsonb_agg(r order by r.created_at),'[]'::jsonb) from public.bite_folio_refund_requests r where r.property_id=p_property));end if;
 if private.bite_can(p_property,'guest_register') then v:=v||jsonb_build_object('compliance',(select coalesce(jsonb_agg(c),'[]'::jsonb) from public.bite_stay_compliance c where c.property_id=p_property));end if;
 if private.bite_can(p_property,'manage_modules') then
  v:=v||jsonb_build_object('outlet_applications',(select coalesce(jsonb_agg(jsonb_build_object('restaurant_id',r.id,'name',r.name,'status',r.status,'onboarding_status',r.onboarding_status,'reason',r.onboarding_rejection_reason)),'[]'::jsonb) from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property),
   'available_outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'city',r.city,'eligible',r.status='Active' and r.onboarding_status='approved')),'[]'::jsonb) from public.restaurant_members m join public.restaurants r on r.id=m.restaurant_id where m.user_id=auth.uid() and m.role='owner' and not exists(select 1 from public.bite_property_outlets o where o.restaurant_id=r.id)));
 end if;
 v:=v||jsonb_build_object('register_version',1);
 if private.bite_can(p_property,'guest_register')then v:=v||jsonb_build_object('next_register_number',(select coalesce(max(register_number),0)+1 from public.bite_stays where property_id=p_property));end if;
 if private.bite_can(p_property,'manage_modules')then v:=v||jsonb_build_object('invoice_series',(select to_jsonb(s)from public.bite_invoice_series s where property_id=p_property and financial_year=private.bite_financial_year(now(),'Asia/Kolkata')));end if;
 if private.bite_can(p_property,'reservations')then
  v:=v||jsonb_build_object('checkin_attempts',(select coalesce(jsonb_agg(jsonb_build_object('request_id',c.request_id,'action',c.action,'id',c.result->'id','folio_id',c.result->'folio_id')order by c.created_at),'[]'::jsonb)from public.bite_property_commands c where c.property_id=p_property and c.created_by=auth.uid()and c.created_at>=now()-interval '24 hours'and c.action in('guest_save','reserve','checkin')));
 end if;
 return v;end $function$;
notify pgrst,'reload schema';
commit;
