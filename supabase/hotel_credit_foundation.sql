-- H13 hotel credit foundation, for isolated CI only until recovery and accounting gates pass.
-- Original folio remains the only source of the unpaid balance. Approval is metadata,
-- not a sale, cash entry, payment, discount, or a duplicate customer ledger.
create table if not exists private.bite_hotel_credit_approvals (
 property_id uuid not null,
 folio_id uuid not null,
 approved_balance numeric(14,2) not null check(approved_balance>0),
 due_date date not null,
 reason text not null check(length(trim(reason)) between 10 and 250),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now(),
 request_id uuid not null,
 primary key(property_id,folio_id),
 unique(property_id,request_id),
 foreign key(property_id,folio_id) references public.bite_folios(property_id,id) on delete restrict
);
alter table private.bite_hotel_credit_approvals enable row level security;
revoke all on table private.bite_hotel_credit_approvals from public,anon,authenticated;

-- Internal validator only: called inside a future atomic credit-checkout command.
-- Does not approve, change folio, issue invoice, or record any financial entry.
create or replace function private.bite_hotel_credit_candidate(
 p_property uuid,p_folio uuid,p_balance numeric,p_due_date date,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 f public.bite_folios%rowtype;
 s public.bite_stays%rowtype;
 t jsonb;
 d date;
begin
 if auth.uid() is null or p_property is null or p_folio is null then
  raise exception 'Authenticated hotel credit review required' using errcode='42501';
 end if;
 if private.bite_property_role(p_property) is distinct from 'owner' and private.bite_property_role(p_property) is distinct from 'manager' then
  raise exception 'Owner or manager credit approval required' using errcode='42501';
 end if;
 perform private.bite_assert_staff_action(p_property,'checkout',jsonb_build_object('folio_id',p_folio));
 if not private.bite_can(p_property,'folios') then raise exception 'Hotel bill access required' using errcode='42501';end if;
 select (now() at time zone timezone)::date into strict d from public.bite_properties where id=p_property and business_type in('hotel','hybrid') for update;
 if p_balance is null or p_balance not between 0.01 and 9999999999.99 or p_balance<>round(p_balance,2) or p_due_date is null or p_due_date<d or p_due_date>d+365 or p_reason is null or length(trim(p_reason)) not between 10 and 250 then
  raise exception 'Enter the exact unpaid balance, due date within one year and approval reason' using errcode='22023';
 end if;
 select * into f from public.bite_folios where property_id=p_property and id=p_folio;
 if not found or f.status<>'open' then raise exception 'Open room bill required';end if;
 select * into strict s from public.bite_stays where property_id=p_property and id=f.stay_id;
 if s.status<>'in_house' then raise exception 'Checked-in room required';end if;
 t:=private.bite_folio_totals(f.id);
 if (t->>'balance')::numeric is distinct from p_balance or (t->>'pending')::numeric is distinct from 0::numeric or (t->>'deposit_held')::numeric is distinct from 0::numeric then
  raise exception 'Review current balance and resolve pending receipts or deposit first';end if;
 if exists(select 1 from public.bite_folio_refund_requests where folio_id=f.id and status in('requested','processing','failed')) or exists(select 1 from public.bite_service_tasks where stay_id=s.id and kind='room_service' and status not in('completed','cancelled')) then
  raise exception 'Resolve outstanding room service or refunds first';end if;
 if exists(select 1 from private.bite_hotel_credit_approvals where property_id=p_property and folio_id=f.id) then
  raise exception 'A credit approval already exists for this folio';end if;
 return jsonb_build_object('folio_id',f.id,'guest_id',s.guest_id,'balance',p_balance,'due_date',p_due_date,'reason',trim(p_reason),'eligible_for_review',true,'checkout_enabled',false);
end
$fn$;
revoke all on function private.bite_hotel_credit_candidate(uuid,uuid,numeric,date,text) from public,anon,authenticated;
comment on table private.bite_hotel_credit_approvals is 'Staged immutable approval metadata. Balance remains in original hotel folio. No client access and no credit checkout enabled.';
