-- Apply after hotel_checkin_scenarios.sql. No guest/room/ledger data is changed.
begin;
do $patch$
declare source text:=pg_get_functiondef('private.bite_hotel_account_command(uuid,text,jsonb,uuid)'::regprocedure);
 anchor text:=$anchor$  if p_action in('reserve','reservation_edit')and p_payload?'arrival_time'then
   if jsonb_typeof(p_payload->'arrival_time')$anchor$;
 guard text:=$guard$  -- Check physical occupation before creating a walk-in reservation or its advance.
  if p_action='reserve'and p_payload->>'booking_mode'='checkin'then
   if not private.bite_can(p_property,'reservations')then raise exception 'Reservation access denied'using errcode='42501';end if;
   if(p_payload->>'arrival')::date>(now()at time zone pr.timezone)::date then raise exception 'For a future arrival, choose Reserve for later.'using errcode='22023',detail='{"field":"arrival"}';end if;
   if not exists(select 1 from public.bite_rooms r where r.property_id=p_property and r.id=(p_payload->>'room_id')::uuid and r.active and r.housekeeping='ready')or exists(select 1 from public.bite_stays s where s.property_id=p_property and s.room_id=(p_payload->>'room_id')::uuid and s.status='in_house')then raise exception 'Room is occupied or not released for check-in. Refresh rooms and choose an available room.'using errcode='22023',detail='{"field":"room_id"}';end if;
  end if;
$guard$;
begin
 if md5(replace(source,guard,''))<>'ca329856a6a2d6a28d03808fff77e3a7'then raise exception 'Hotel account command changed since physical-room guard review';end if;
 if strpos(source,guard)>0 then return;end if;
 if(length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'Physical-room guard insertion point changed';end if;
 execute replace(source,anchor,guard||anchor);
end$patch$;
notify pgrst,'reload schema';
commit;
