-- H10 isolated staging proposal. Apply to production only after exact-head isolated QA.
-- No direct table writes: existing role-checked commands perform every mutation.
create or replace function public.bite_booking_with_deposit(
 p_property uuid,p_booking_kind text,p_payload jsonb,p_request uuid
) returns jsonb language plpgsql security invoker set search_path to ''
as $fn$
declare
 d jsonb;
 amount numeric;
 method text;
 reference text;
 verified boolean;
 account_note text;
 booking jsonb;
 folio uuid;
 held jsonb;
 hold_request uuid;
 confirm_request uuid;
 checkin_request uuid;
begin
 if auth.uid() is null or p_request is null or p_property is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Login and a stable booking request are required' using errcode='42501';
 end if;
 if p_booking_kind not in ('single','family') or p_booking_kind is null then raise exception 'Choose a single or family booking';end if;
 d:=p_payload->'checkin_deposit';
 if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'amount') is distinct from 'number' then raise exception 'Enter a separate refundable deposit amount';end if;
 amount:=(d->>'amount')::numeric;
 if amount not between 0.01 and 9999999999.99 or amount<>round(amount,2) then raise exception 'Enter a positive deposit amount with at most two decimals';end if;
 method:=d->>'method';
 if method is null or method not in ('Cash','UPI','Card','Bank Transfer') then raise exception 'Select the deposit collection method';end if;
 if d ? 'verified' and jsonb_typeof(d->'verified') is distinct from 'boolean' then raise exception 'Invalid verification status';end if;
 verified:=coalesce((d->>'verified')::boolean,false);
 reference:=trim(coalesce(d->>'reference',''));
 account_note:=trim(coalesce(d->>'account_note',''));
 if length(reference)>100 or length(account_note)>80 then raise exception 'Deposit reference or account note is too long';end if;
 if verified and method<>'Cash' and reference='' then raise exception 'Verified online deposit needs the actual bank/provider reference';end if;
 -- Exact payload including deposit stays in the existing booking request log.
 -- Separate deterministic request IDs reuse existing idempotency and permission guards.
 hold_request:=md5(p_request::text||':bite-h10:deposit-hold')::uuid;
 confirm_request:=md5(p_request::text||':bite-h10:deposit-confirm')::uuid;
 checkin_request:=md5(p_request::text||':bite-h10:checkin')::uuid;
 if p_booking_kind='family' then
  booking:=public.bite_family_booking(p_property,p_payload,p_request);
  folio:=(booking->'stays'->0->>'folio_id')::uuid;
 else
  if coalesce(p_payload->>'booking_mode','') not in ('reserve','checkin') then raise exception 'Choose Check-in or Reserve';end if;
  booking:=public.bite_property_command(p_property,'reserve',p_payload,p_request);
  folio:=(booking->>'folio_id')::uuid;
 end if;
 if folio is null then raise exception 'Booking folio could not be verified';end if;
 held:=public.bite_property_command(p_property,'deposit_hold',jsonb_build_object(
  'folio_id',folio,'description','Refundable security deposit at booking','amount',amount,
  'method',method,'reference',reference,'account_note',account_note
 ),hold_request);
 if nullif(held->>'id','') is null then raise exception 'Deposit receipt could not be verified';end if;
 if verified and method<>'Cash' then
  perform public.bite_property_command(p_property,'payment_confirm',jsonb_build_object(
   'folio_id',folio,'id',held->>'id','reference',reference,'account_note',account_note
  ),confirm_request);
 end if;
 if p_booking_kind='single' and p_payload->>'booking_mode'='checkin' then
  perform public.bite_property_command(p_property,'checkin',jsonb_build_object('id',booking->>'id'),checkin_request);
  booking:=booking||jsonb_build_object('checkin_completed',true);
 end if;
 return booking||jsonb_build_object('deposit_entry_id',held->>'id','deposit_folio_id',folio);
end $fn$;
revoke all on function public.bite_booking_with_deposit(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.bite_booking_with_deposit(uuid,text,jsonb,uuid) to authenticated;
