-- Atomic, idempotent family / multi-room check-in on the existing hotel ledger.
-- No new guest-payment ledger; every selected room retains its own stay and folio.
-- Existing private.bite_property_command remains the sole allocation, tax and POS guard.
create or replace function public.bite_family_booking(
 p_property uuid, p_payload jsonb, p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_property public.bite_properties;
 v_prior public.bite_property_commands;
 v_group uuid;
 v_lead uuid;
 v_guest uuid;
 v_result jsonb;
 v_booking jsonb;
 v_unit jsonb;
 v_room uuid;
 v_seen uuid[]:='{}'::uuid[];
 v_mode text;
 v_name text;
 v_stays jsonb:='[]'::jsonb;
 v_index integer:=0;
 v_count integer;
begin
 if v_actor is null or p_request is null or p_payload is null
    or jsonb_typeof(p_payload)<>'object' then
  raise exception 'Login and a stable booking request are required' using errcode='42501';
 end if;
 if not private.bite_can(p_property,'reservations')
    or not private.bite_can(p_property,'guest_register')
    or not private.bite_can(p_property,'folios') then
  raise exception 'This property role cannot create family check-ins' using errcode='42501';
 end if;
 -- Serialize all allocations and retries with the existing per-property command lock.
 select * into v_property from public.bite_properties where id=p_property for update;
 if not found then raise exception 'Property not found'; end if;
 select * into v_prior from public.bite_property_commands
 where property_id=p_property and request_id=p_request;
 if found then
  if v_prior.action<>'family_booking' or v_prior.payload<>p_payload or v_prior.created_by<>v_actor then
   raise exception 'Request ID already used with different booking details' using errcode='42501';
  end if;
  return v_prior.result;
 end if;
 v_mode:=coalesce(p_payload->>'mode','');
 if v_mode not in ('checkin','reserve') then raise exception 'Select Check in now or Reserve for later'; end if;
 v_name:=trim(coalesce(p_payload->>'name',''));
 if length(v_name) not between 1 and 120 then raise exception 'Family name must be 1 to 120 characters'; end if;
 if jsonb_typeof(p_payload->'rooms') is distinct from 'array' then
  raise exception 'Choose rooms for this family booking';
 end if;
 v_count:=jsonb_array_length(p_payload->'rooms');
 if v_count not between 2 and 15 then raise exception 'Select 2 to 15 rooms for one family booking'; end if;
 v_lead:=(p_payload->>'guest_id')::uuid;
 if not exists(select 1 from public.bite_guests where id=v_lead and property_id=p_property) then
  raise exception 'Lead guest belongs to another property or was not saved' using errcode='42501';
 end if;
 if v_mode='checkin' and (p_payload->>'arrival')::date<>(now() at time zone v_property.timezone)::date then
  raise exception 'For another arrival date choose Reserve for later';
 end if;
 if coalesce((p_payload->>'advance_amount')::numeric,0)<>0 then
  raise exception 'Record family payment against a selected room folio after booking; do not duplicate the group receipt';
 end if;
 -- Group created in the same transaction as every room reservation/check-in.
 -- Any full-room, date, capacity, tax or access failure rolls back the WHOLE group.
 insert into public.bite_booking_groups(property_id,name,payer_guest_id)
 values(p_property,v_name,v_lead) returning id into v_group;
 for v_unit in select value from jsonb_array_elements(p_payload->'rooms') loop
  v_index:=v_index+1;
  if jsonb_typeof(v_unit)<>'object' then raise exception 'Room % details are missing',v_index;end if;
  v_room:=(v_unit->>'room_id')::uuid;
  if v_room is null or v_room=any(v_seen) then raise exception 'A room was selected twice or is missing';end if;
  v_seen:=array_append(v_seen,v_room);
  v_guest:=coalesce(nullif(v_unit->>'guest_id','')::uuid,v_lead);
  if not exists(select 1 from public.bite_guests where id=v_guest and property_id=p_property) then
   raise exception 'Room guest belongs to another property' using errcode='42501';
  end if;
  if (v_unit->>'nightly_rate')::numeric is null
   or (v_unit->>'nightly_rate')::numeric<0
   or (v_unit->>'nightly_rate')::numeric>9999999999.99
   or (v_unit->>'nightly_rate')::numeric<>round((v_unit->>'nightly_rate')::numeric,2) then
   raise exception 'Invalid agreed nightly room rate in room %',v_index;
  end if;
  v_booking:=jsonb_build_object(
   'guest_id',v_guest,
   'room_id',v_room,
   'arrival',p_payload->>'arrival',
   'departure',p_payload->>'departure',
   'adults',v_unit->'adults',
   'children',coalesce(v_unit->'children','0'::jsonb),
   'nightly_rate',v_unit->'nightly_rate',
   'booking_source',coalesce(p_payload->>'booking_source','walk_in'),
   'booking_reference',coalesce(p_payload->>'booking_reference',''),
   'booking_mode',v_mode,
   'arrival_time',coalesce(p_payload->>'arrival_time',''),
   'terms_at_checkin',true,
   'compliance_note',left(trim(coalesce(v_unit->>'note','')),250)
  );
  if v_unit ? 'quote_hash' and nullif(v_unit->>'quote_hash','') is not null then
   v_booking:=v_booking||jsonb_build_object('quote_hash',v_unit->>'quote_hash');
  end if;
  if v_unit ? 'registration' then
   v_booking:=v_booking||jsonb_build_object('registration',v_unit->'registration');
  elsif v_index=1 and p_payload ? 'registration' then
   v_booking:=v_booking||jsonb_build_object('registration',p_payload->'registration');
  end if;
  v_result:=public.bite_property_command(p_property,'reserve',v_booking,gen_random_uuid());
  update public.bite_stays set group_id=v_group
  where property_id=p_property and id=(v_result->>'id')::uuid;
  if v_mode='checkin' then
   perform public.bite_property_command(
    p_property,'checkin',jsonb_build_object('id',v_result->>'id'),gen_random_uuid()
   );
  end if;
  v_stays:=v_stays||jsonb_build_array(jsonb_build_object(
   'id',v_result->>'id','folio_id',v_result->>'folio_id','room_id',v_room,
   'status',case when v_mode='checkin' then 'in_house' else 'reserved' end
  ));
 end loop;
 v_result:=jsonb_build_object('id',v_group,'mode',v_mode,'stays',v_stays,'confirmed',true);
 insert into public.bite_property_commands(property_id,request_id,action,payload,result,created_by)
 values(p_property,p_request,'family_booking',p_payload,v_result,v_actor);
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
 values(p_property,v_actor,'family_booking',v_group,p_request);
 return v_result;
end;
$$;
revoke all on function public.bite_family_booking(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.bite_family_booking(uuid,jsonb,uuid) to authenticated;
