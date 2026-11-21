-- H13 split tender checkout: stage in disposable CI before production.
-- Reuse the existing checkout lock, request replay, authorization and receipt commands.
-- Cash allocated deterministically by room-folio ID, then verified UPI; no gateway payment.
do $patch$
declare
 definition text;
 needle text;
 replacement text;
 pairs text[][]:=array[
 array[$old$bill_ids jsonb;bill_sum numeric;begin$old$,$new$bill_ids jsonb;bill_sum numeric;split_cash numeric;split_upi numeric;room_due numeric;room_cash numeric;room_upi numeric;child_payload jsonb;begin$new$],
 array[$old$entity:=nullif(p_payload->>'id','')::uuid;$old$,$new$if p_action in ('checkout_collect','booking_checkout_collect') and p_payload->>'method'='Split' then
  if role_name not in ('owner','manager') then raise exception 'Owner or manager must verify mixed checkout receipts' using errcode='42501';end if;
  if jsonb_typeof(p_payload->'cash_amount') is distinct from 'number' or jsonb_typeof(p_payload->'upi_amount') is distinct from 'number' or jsonb_typeof(p_payload->'amount') is distinct from 'number' then
   raise exception 'Enter valid cash and UPI amounts' using errcode='22023';end if;
  split_cash:=(p_payload->>'cash_amount')::numeric;split_upi:=(p_payload->>'upi_amount')::numeric;
  if split_cash not between 0.01 and 9999999999.99 or split_upi not between 0.01 and 9999999999.99 or split_cash<>round(split_cash,2) or split_upi<>round(split_upi,2) or split_cash+split_upi is distinct from (p_payload->>'amount')::numeric then
   raise exception 'Cash and UPI must equal the full checkout balance' using errcode='22023';end if;
  if p_payload->'verified' is distinct from 'true'::jsonb or nullif(trim(p_payload->>'reference'),'') is null or length(p_payload->>'reference')>100 then
   raise exception 'Verify UPI receipt and enter its bank reference' using errcode='22023';end if;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;$new$],
 array[$old$cfg:=private.bite_hotel_account_command(p_property,'checkout_collect',p_payload||jsonb_build_object('folio_id',bill_row.id,'amount',(bill_row.totals->>'balance')::numeric),gen_random_uuid());$old$,$new$room_due:=(bill_row.totals->>'balance')::numeric;
   child_payload:=p_payload||jsonb_build_object('folio_id',bill_row.id,'amount',room_due);
   if p_payload->>'method'='Split' then
    room_cash:=least(split_cash,room_due);room_upi:=room_due-room_cash;split_cash:=split_cash-room_cash;
    child_payload:=(child_payload-'cash_amount'-'upi_amount')||jsonb_build_object('method',case when room_upi=0 then 'Cash' when room_cash=0 then 'UPI' else 'Split' end);
    if room_cash>0 and room_upi>0 then child_payload:=child_payload||jsonb_build_object('cash_amount',room_cash,'upi_amount',room_upi);end if;
    if room_upi=0 then child_payload:=child_payload||jsonb_build_object('reference','','account_note','','verified',false);end if;
   end if;
   cfg:=private.bite_hotel_account_command(p_property,'checkout_collect',child_payload,gen_random_uuid());$new$],
 array[$old$if amount>0 then
    v:=private.bite_hotel_account_command(p_property,'payment',p_payload||jsonb_build_object('description','Final checkout payment'),gen_random_uuid());$old$,$new$if amount>0 and p_payload->>'method'='Split' then
    perform private.bite_hotel_account_command(p_property,'payment',(p_payload-'cash_amount'-'upi_amount')||jsonb_build_object('amount',split_cash,'method','Cash','reference','','account_note','','verified',false,'description','Final checkout cash payment'),gen_random_uuid());
    v:=private.bite_hotel_account_command(p_property,'payment',(p_payload-'cash_amount'-'upi_amount')||jsonb_build_object('amount',split_upi,'method','UPI','description','Final checkout UPI payment'),gen_random_uuid());
    perform private.bite_hotel_account_command(p_property,'payment_confirm',jsonb_build_object('id',v->>'id','folio_id',f.id,'description','Checkout UPI receipt verified','reference',p_payload->>'reference','account_note',p_payload->>'account_note'),gen_random_uuid());
   elsif amount>0 then
    v:=private.bite_hotel_account_command(p_property,'payment',p_payload||jsonb_build_object('description','Final checkout payment'),gen_random_uuid());$new$]
 ];
 pair text[];
begin
 select pg_get_functiondef('private.bite_hotel_account_command_before_staff_permissions(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if strpos(definition,'split_cash numeric;split_upi numeric;')>0 then
  if strpos(definition,'Final checkout UPI payment')=0 or strpos(definition,'room_cash:=least(split_cash,room_due)')=0 then raise exception 'Incomplete split checkout patch';end if;
  return;
 end if;
 if strpos(definition,'selected_only')=0 or strpos(definition,'select * into strict pr from public.bite_properties where id=p_property for update')=0 then raise exception 'Selected checkout patch and property lock required';end if;
 foreach pair slice 1 in array pairs loop
  needle:=pair[1];replacement:=pair[2];
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'H13 split patch incompatible with checkout source: %',left(needle,80);end if;
  definition:=replace(definition,needle,replacement);
 end loop;
 execute definition;
end
$patch$;
