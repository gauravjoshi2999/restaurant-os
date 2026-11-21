-- Draft H13 selected family room checkout. Run first on isolated CI.
-- Keep existing role guard, property lock, request replay and per-room atomic checkout.
-- No new exposed RPC. Legacy all-room checkout retains exact-set validation.
do $patch$
declare
 definition text;
 prior_clause text:=$old$and bs.group_id=book_id and bf.status='open'and bs.status='in_house'$old$;
 selected_clause text:=$new$and bs.group_id=book_id and bf.status='open'and bs.status='in_house'
   and (not coalesce((p_payload->>'selected_only')::boolean,false) or (p_payload->'folio_ids') ? bf.id::text)$new$;
 old_gate text:=$old$custom:=true;book_id:=(p_payload->>'group_id')::uuid;$old$;
 new_gate text:=$new$custom:=true;book_id:=(p_payload->>'group_id')::uuid;
  if p_payload ? 'selected_only' and jsonb_typeof(p_payload->'selected_only') is distinct from 'boolean' then
   raise exception 'Invalid selected rooms option' using errcode='22023';
  end if;
  if coalesce((p_payload->>'selected_only')::boolean,false) and
     (jsonb_typeof(p_payload->'folio_ids') is distinct from 'array' or book_id is null) then
   raise exception 'Select valid active rooms' using errcode='22023';
  end if;$new$;
begin
 select pg_get_functiondef('private.bite_hotel_account_command_before_staff_permissions(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if strpos(definition,selected_clause)>0 and strpos(definition,new_gate)>0 then return;end if;
 if (length(definition)-length(replace(definition,prior_clause,'')))/length(prior_clause)<>2
    or (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1
    or strpos(definition,'bill_ids is distinct from p_payload->''folio_ids''')=0
    or strpos(definition,'select * into strict pr from public.bite_properties where id=p_property for update')=0 then
   raise exception 'H13 patch incompatible with current checkout function; review exact source before applying';
 end if;
 execute replace(replace(definition,prior_clause,selected_clause),old_gate,new_gate);
end
$patch$;
