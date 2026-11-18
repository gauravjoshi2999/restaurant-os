-- Entry permission includes confirming an unchanged saved room allocation.
create or replace function private.bite_assert_staff_action(p_property uuid,p_action text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare permission text;
begin
 if auth.uid() is null or private.bite_property_role(p_property) is null then raise exception 'Property access denied' using errcode='42501';end if;
 -- Permission changes and commands lock the same property, so revocation cannot race a write.
 perform 1 from public.bite_properties where id=p_property for update;
 if private.bite_property_role(p_property)='owner' then return;end if;
 -- Confirming a saved reservation resubmits its unchanged allocation. This is
 -- part of check-in entry, while an actual room/date/count edit needs stay_manage.
 if p_action='reservation_edit' and private.bite_staff_can(p_property,'checkin')
 and (select coalesce(array_agg(k),array[]::text[]) from jsonb_object_keys(p_payload) k)<@array['id','room_id','arrival','departure','adults','children','arrival_time','terms_at_checkin']
 and exists(select 1 from public.bite_stays st where st.property_id=p_property and st.id=(p_payload->>'id')::uuid and st.status='reserved'
  and st.room_id=(p_payload->>'room_id')::uuid and st.arrival=(p_payload->>'arrival')::date and st.departure=(p_payload->>'departure')::date
  and st.adults=(p_payload->>'adults')::integer and st.children=coalesce((p_payload->>'children')::integer,0)) then return;end if;

 permission:=case
 when p_action='guest_save' then 'guest_entry'
 when p_action in('reserve','reserve_group') then 'reservation_entry'
 when p_action='checkin' then 'checkin'
 when p_action in('reservation_edit','move','extend','cancel','no_show','compliance_save') then 'stay_manage'
 when p_action in('checkout','checkout_collect','booking_checkout_collect','apply_checkout_policy','payer_split','split_bill','late_checkout') then 'checkout'
 when p_action='booking_bill' then 'folios'
 when p_action in('payment','deposit_hold','deposit_apply','deposit_return') then 'payment_entry'
 when p_action in('payment_confirm','payment_void','account_note') then 'payment_verify'
 when p_action in('charge','room_post','room_pos','room_reconcile') then 'room_charge'
 when p_action='pos_sale' then 'pos_entry'
 when p_action in('discount','reverse') then 'discount'
 when p_action in('refund','refund_request','refund_decide') then 'refund'
 when p_action='room_save' then 'room_manage'
 when p_action in('room_status','room_privacy') then 'housekeeping_work'
 when p_action='task_update' then case when exists(select 1 from public.bite_service_tasks where property_id=p_property and id=(p_payload->>'id')::uuid and kind='room_service') then 'room_service_work' else 'housekeeping_work' end
 when p_action='expense' then 'expense_entry'
 when p_action='daybook_entry' then 'daybook_entry'
 when p_action='close_shift' then 'close_day'
 when p_action='abandon_checkin' then 'reservation_entry'
 else 'owner_only' end;
 if not private.bite_staff_can(p_property,permission) then raise exception 'Owner has not allowed this action: %',p_action using errcode='42501';end if;
 if p_action='reserve' and coalesce((p_payload->>'advance_amount')::numeric,0)>0 and not private.bite_staff_can(p_property,'payment_entry') then raise exception 'Owner permission required to record an advance' using errcode='42501';end if;
 if p_action in('reserve','payment','checkout_collect') and coalesce((p_payload->>'advance_verified')::boolean,(p_payload->>'verified')::boolean,false) and not private.bite_staff_can(p_property,'payment_verify') then raise exception 'Owner permission required to verify a bank receipt' using errcode='42501';end if;
end $$;
