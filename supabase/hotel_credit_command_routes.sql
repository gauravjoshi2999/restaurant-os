-- Staged API integration: extend existing authenticated property command only.
-- No new public security definer RPC, no grants to approval table or private helpers.
do $patch$
declare definition text;
 old_gate text:=$old$perform private.bite_assert_staff_action(p_property,p_action,p_payload);$old$;
 new_gate text:=$new$if p_action in ('hotel_credit_checkout','hotel_credit_receipt','hotel_credit_list') then
  if auth.uid() is null or p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or coalesce(private.bite_property_role(p_property),'') not in ('owner','manager') then
   raise exception 'Owner or manager hotel credit access required' using errcode='42501';end if;
  if p_action='hotel_credit_checkout' then
   return private.bite_hotel_credit_checkout(p_property,(p_payload->>'folio_id')::uuid,(p_payload->>'balance')::numeric,(p_payload->>'due_date')::date,p_payload->>'reason',p_request);
  elsif p_action='hotel_credit_receipt' then
   return private.bite_hotel_credit_receipt(p_property,(p_payload->>'folio_id')::uuid,(p_payload->>'amount')::numeric,p_payload->>'method',p_payload->>'reference',p_payload->>'account_note',(p_payload->>'verified')::boolean,p_request);
  else
   perform private.bite_assert_staff_action(p_property,'booking_bill',p_payload);
   if not private.bite_can(p_property,'folios') then raise exception 'Folio access required' using errcode='42501';end if;
   select coalesce(jsonb_agg(jsonb_build_object('folio_id',a.folio_id,'guest_id',s.guest_id,'guest_name',g.full_name,'room',r.number,'invoice_number',f.invoice_number,'approved_balance',a.approved_balance,'due_date',a.due_date,'balance',(private.bite_folio_totals(f.id)->>'balance')::numeric) order by a.due_date,a.folio_id),'[]'::jsonb) into result
   from private.bite_hotel_credit_approvals a
   join public.bite_folios f on f.property_id=a.property_id and f.id=a.folio_id
   join public.bite_stays s on s.property_id=f.property_id and s.id=f.stay_id
   join public.bite_guests g on g.property_id=s.property_id and g.id=s.guest_id
   join public.bite_rooms r on r.property_id=s.property_id and r.id=s.room_id
   where a.property_id=p_property and f.status='settled' and s.status='checked_out' and (f.invoice_snapshot->'totals'->>'balance')::numeric=a.approved_balance;
   return jsonb_build_object('accounts',result);
  end if;
 end if;
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);$new$;
begin
 select pg_get_functiondef('private.bite_hotel_account_command(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if strpos(definition,new_gate)>0 then return;end if;
 if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 or strpos(definition,'bite_hotel_account_command_before_staff_permissions')=0 then raise exception 'Hotel credit route source changed';end if;
 execute replace(definition,old_gate,new_gate);
end
$patch$;
