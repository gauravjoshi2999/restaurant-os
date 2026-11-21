-- H13 staged atomic credit checkout. Private command only; no API exposure.
-- Approval insert and existing checkout command are one transaction. Never fabricate payment.
do $patch$
declare definition text;
 old_guard text:=$old$if (total->>'balance')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;$old$;
 new_guard text:=$new$if (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 or ((total->>'balance')::numeric<>0 and not exists(
    select 1 from private.bite_hotel_credit_approvals a
    where a.property_id=p_property and a.folio_id=folio.id
    and a.approved_balance=(total->>'balance')::numeric and a.approved_balance>0
    and a.approved_by=auth.uid() and a.request_id::text=p_payload->>'credit_approval_request'
   )) then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;$new$;
 old_invoice text:=$old$cfg:=cfg||jsonb_build_object('splits',private.bite_split_invoice(cfg,f.payer_split));$old$;
 new_invoice text:=$new$cfg:=cfg||jsonb_build_object('splits',private.bite_split_invoice(cfg,f.payer_split));
   if p_payload?'credit_approval_request' then
    select cfg||jsonb_build_object('credit',jsonb_build_object('amount',a.approved_balance,'due_date',a.due_date,'status','unpaid')) into strict cfg
    from private.bite_hotel_credit_approvals a where a.property_id=p_property and a.folio_id=f.id and a.request_id::text=p_payload->>'credit_approval_request' and a.approved_by=auth.uid();
   end if;$new$;
begin
 select pg_get_functiondef('private.bite_property_command_before_staff_permissions(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if strpos(definition,new_guard)=0 then
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then raise exception 'Credit checkout guard source changed';end if;
  execute replace(definition,old_guard,new_guard);
 end if;
 select pg_get_functiondef('private.bite_hotel_account_command_before_staff_permissions(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 if strpos(definition,new_invoice)=0 then
  if (length(definition)-length(replace(definition,old_invoice,'')))/length(old_invoice)<>1 then raise exception 'Credit invoice source changed';end if;
  execute replace(definition,old_invoice,new_invoice);
 end if;
end
$patch$;
create or replace function private.bite_hotel_credit_checkout(
 p_property uuid,p_folio uuid,p_balance numeric,p_due_date date,p_reason text,p_request uuid
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 prior public.bite_property_commands%rowtype; payload jsonb; candidate jsonb; closed jsonb; d date; billing_mode text; invoice jsonb;
begin
 if auth.uid() is null or p_request is null or p_folio is null or coalesce(private.bite_property_role(p_property),'') not in('owner','manager') then raise exception 'Owner or manager credit checkout required' using errcode='42501';end if;
 perform private.bite_assert_staff_action(p_property,'checkout',jsonb_build_object('folio_id',p_folio));
 if not private.bite_can(p_property,'folios') then raise exception 'Folio permission required' using errcode='42501';end if;
 select (now() at time zone timezone)::date,case when nullif(tax_profile->>'gstin','') is null then 'plain' else 'gst' end into strict d,billing_mode from public.bite_properties where id=p_property for update;
 payload:=jsonb_build_object('folio_id',p_folio,'balance',p_balance,'due_date',p_due_date,'reason',trim(p_reason));
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>'hotel_credit_checkout' or prior.payload<>payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details';end if;
  return prior.result;
 end if;
 if exists(select 1 from public.bite_property_shift_closings where property_id=p_property and shift_date=d and locked) then raise exception 'Current property day is locked';end if;
 -- Recalculate current tax before comparing the approved outstanding amount.
 perform private.bite_apply_bill_tax(p_property,p_folio,billing_mode);
 candidate:=private.bite_hotel_credit_candidate(p_property,p_folio,p_balance,p_due_date,p_reason);
 insert into private.bite_hotel_credit_approvals(property_id,folio_id,approved_balance,due_date,reason,approved_by,request_id)
 values(p_property,p_folio,p_balance,p_due_date,trim(p_reason),auth.uid(),p_request);
 closed:=private.bite_hotel_account_command(p_property,'checkout',jsonb_build_object('folio_id',p_folio,'credit_approval_request',p_request),gen_random_uuid());
 invoice:=closed->'invoice';
 if (invoice->'totals'->>'balance')::numeric is distinct from p_balance or (invoice->'credit'->>'amount')::numeric is distinct from p_balance or invoice->'credit'->>'status' is distinct from 'unpaid' then raise exception 'Credit invoice did not retain the approved amount';end if;
 if not exists(select 1 from public.bite_folios f join public.bite_stays s on s.id=f.stay_id and s.property_id=f.property_id where f.id=p_folio and f.property_id=p_property and f.status='settled' and s.status='checked_out' and f.invoice_snapshot=invoice) then raise exception 'Credit checkout status not verified';end if;
 insert into public.bite_property_commands values(p_property,p_request,'hotel_credit_checkout',payload,closed,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),'hotel_credit_checkout',p_folio,p_request);
 return closed;
end
$fn$;
revoke all on function private.bite_hotel_credit_checkout(uuid,uuid,numeric,date,text,uuid) from public,anon,authenticated;
