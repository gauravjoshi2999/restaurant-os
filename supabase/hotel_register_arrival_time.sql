-- Captured guest arrival clock time; existing hotel timing and payment policies stay authoritative.
-- Apply after hotel_guest_register_accounts.sql. Replaces the same guarded private command.
begin;
do $preflight$begin
 if md5(pg_get_functiondef('private.bite_hotel_account_command(uuid,text,jsonb,uuid)'::regprocedure))not in('082722cbe12e7ff152dfd2da783cd192','5eefffb740346152bc6a77f16a7ed70e')then
  raise exception 'Hotel command changed since review. Rebase the arrival-time migration before applying.';
 end if;
end$preflight$;
alter table public.bite_stays add column if not exists arrival_time time without time zone;
comment on column public.bite_stays.arrival_time is 'Recorded arrival time on the arrival date, in the property timezone. Separate from the actual checked_in_at audit timestamp and scheduled_arrival_at hotel policy.';

CREATE OR REPLACE FUNCTION private.bite_hotel_account_command(p_property uuid, p_action text, p_payload jsonb, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr public.bite_properties;prior public.bite_property_commands;role_name text;v jsonb;cfg jsonb;t jsonb;s public.bite_stays;f public.bite_folios;series public.bite_invoice_series;
 entity uuid;fid uuid;amount numeric;d date;k text;custom boolean:=false;begin
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
   if not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=nullif(cfg->>'id_front','')::uuid and kind='masked_id'and status='ready')then raise exception 'Upload the ID front before confirming check-in';end if;
   if nullif(cfg->>'id_back','')is not null and not exists(select 1 from public.bite_guest_documents where property_id=p_property and guest_id=(p_payload->>'guest_id')::uuid and id=(cfg->>'id_back')::uuid and status='ready')then raise exception 'ID back has not been saved for this guest';end if;
  end if;
  if p_action='checkin'then
   select * into strict s from public.bite_stays where property_id=p_property and id=entity;
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
end$function$

notify pgrst,'reload schema';
commit;

