-- H13 staged post-checkout recovery. Private only; activation requires atomic credit checkout.
-- Use original folio payment entry so existing Daily Book recognizes actual receipt exactly once.
create or replace function private.bite_hotel_credit_receipt(
 p_property uuid,p_folio uuid,p_amount numeric,p_method text,p_reference text,p_account text,p_verified boolean,p_request uuid
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 a private.bite_hotel_credit_approvals%rowtype; f public.bite_folios%rowtype;
 s public.bite_stays%rowtype; prior public.bite_property_commands%rowtype;
 t jsonb; payload jsonb; result jsonb; entry_id uuid; d date;
 ref text:=trim(coalesce(p_reference,'')); account text:=trim(coalesce(p_account,''));
begin
 if auth.uid() is null or p_request is null or p_folio is null then raise exception 'Authenticated credit receipt required' using errcode='42501';end if;
 if coalesce(private.bite_property_role(p_property),'') not in('owner','manager') then raise exception 'Owner or manager receipt permission required' using errcode='42501';end if;
 perform private.bite_assert_staff_action(p_property,'payment',jsonb_build_object('folio_id',p_folio));
 if not private.bite_can(p_property,'folios') then raise exception 'Hotel folio permission required' using errcode='42501';end if;
 select (now() at time zone timezone)::date into strict d from public.bite_properties where id=p_property for update;
 if p_amount is null or p_amount not between 0.01 and 9999999999.99 or p_amount<>round(p_amount,2) or p_method is null or p_method not in('Cash','UPI','Card','Bank Transfer') or length(ref)>100 or length(account)>80 then raise exception 'Valid receipt amount and method required';end if;
 if p_method<>'Cash' and (p_verified is distinct from true or ref='') then raise exception 'Verify bank receipt and reference first';end if;
 if p_method<>'Cash' then perform private.bite_assert_staff_action(p_property,'payment_confirm',jsonb_build_object('folio_id',p_folio));end if;
 payload:=jsonb_build_object('folio_id',p_folio,'amount',p_amount,'method',p_method,'reference',ref,'account_note',account,'verified',coalesce(p_verified,false));
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>'hotel_credit_receipt' or prior.payload<>payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details';end if;
  return prior.result;
 end if;
 select * into a from private.bite_hotel_credit_approvals where property_id=p_property and folio_id=p_folio;
 if not found then raise exception 'Approved hotel receivable required';end if;
 select * into strict f from public.bite_folios where property_id=p_property and id=p_folio;
 select * into strict s from public.bite_stays where property_id=p_property and id=f.stay_id;
 if f.status<>'settled' or s.status<>'checked_out' or f.invoice_snapshot is null or (f.invoice_snapshot->'totals'->>'balance')::numeric is distinct from a.approved_balance then raise exception 'Issued credit invoice required; review original bill';end if;
 t:=private.bite_folio_totals(f.id);
 if (t->>'balance')::numeric is null or (t->>'balance')::numeric>a.approved_balance or p_amount>(t->>'balance')::numeric or (t->>'pending')::numeric is distinct from 0::numeric or (t->>'deposit_held')::numeric is distinct from 0::numeric then raise exception 'Review outstanding balance before recording collection';end if;
 if exists(select 1 from public.bite_property_shift_closings where property_id=p_property and shift_date=d and locked) then raise exception 'Current property day is locked';end if;
 insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,method,status,reference,account_note,created_by)
 values(p_property,p_folio,'payment','payment','Hotel guest credit recovery',p_amount,p_method,'confirmed',ref,account,auth.uid()) returning id into entry_id;
 t:=private.bite_folio_totals(f.id);
 result:=jsonb_build_object('id',entry_id,'folio_id',p_folio,'balance',(t->>'balance')::numeric,'confirmed',true);
 insert into public.bite_property_commands values(p_property,p_request,'hotel_credit_receipt',payload,result,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),'hotel_credit_receipt',entry_id,p_request);
 return result;
end
$fn$;
revoke all on function private.bite_hotel_credit_receipt(uuid,uuid,numeric,text,text,text,boolean,uuid) from public,anon,authenticated;
