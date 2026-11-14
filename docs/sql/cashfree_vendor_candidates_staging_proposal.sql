-- BITE SECURITY REVIEW / STAGING ONLY: do NOT run on production.
-- Not a deployed migration. Does not activate Easy Split or create payouts.
-- Stage after independent provider and bank/KYC workflow design approval.
create table public.bite_cashfree_vendor_candidates(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 vendor_id text not null unique,
 evidence_order_id uuid not null references public.orders(id) on delete restrict,
 evidence_intent_id uuid not null references public.bite_live_checkout_intents(id) on delete restrict,
 observed_split_amount numeric(14,2) not null,
 observed_by uuid not null,
 observed_at timestamptz not null default now(),
 mapping_state text not null default 'CANDIDATE_ONLY',
 constraint bite_vendor_candidate_id_syntax check(vendor_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 constraint bite_vendor_candidate_amount check(
  observed_split_amount >= 0 and observed_split_amount::text not in ('NaN','Infinity','-Infinity')
 ),
 constraint bite_vendor_candidate_not_approved check(mapping_state='CANDIDATE_ONLY')
);

-- No direct client access. Deliberately no RLS policies; service_role is
-- separately authenticated/authorized inside the Edge Function before INSERT.
alter table public.bite_cashfree_vendor_candidates enable row level security;
revoke all on table public.bite_cashfree_vendor_candidates from public, anon, authenticated;
grant select,insert on public.bite_cashfree_vendor_candidates to service_role;

create or replace function public.guard_bite_cashfree_vendor_candidate()
returns trigger
language plpgsql
security invoker
set search_path=''
as $guard$
declare v_total numeric(14,2);
begin
 if tg_op<>'INSERT' then
  raise exception 'Vendor candidates are immutable; review by new audited process';
 end if;
 select o.amount into v_total
 from public.orders o
 join public.bite_live_checkout_intents i
   on i.activated_order_id=o.id and i.id=new.evidence_intent_id
 where o.id=new.evidence_order_id
   and o.restaurant_id=new.restaurant_id
   and o.channel='Own Platform'
   and o.is_demo is false
   and i.restaurant_id=new.restaurant_id
   and i.status='activated' and i.currency='INR'
   and i.provider_order_id='bite_live_'||pg_catalog.replace(i.id::text,'-','')
   and i.amount=o.amount;
 if not found then
  raise exception 'Candidate evidence must belong to activated live order in this restaurant';
 end if;
 if new.observed_split_amount>v_total then
  raise exception 'Observed vendor amount exceeds the trusted order amount';
 end if;
 return new;
end;
$guard$;

revoke all on function public.guard_bite_cashfree_vendor_candidate()
 from public,anon,authenticated;
grant execute on function public.guard_bite_cashfree_vendor_candidate() to service_role;
create trigger bite_cashfree_vendor_candidate_guard
before insert or update or delete
on public.bite_cashfree_vendor_candidates
for each row execute function public.guard_bite_cashfree_vendor_candidate();

-- No approved mappings, bank account numbers, UTRs, transfer initiation
-- or settlement status exists in this table by design.
