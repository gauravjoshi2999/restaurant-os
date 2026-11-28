-- Paid lifecycle rehearsal. Only sandbox receipts and synthetic bill IDs enter this ledger.
create table private.bite_sandbox_subscription_terms (
 receipt_id uuid primary key references private.bite_subscription_sandbox_receipts(attempt_id),
 property_id uuid not null references public.bite_properties(id),
 tier text not null check (tier in ('starter','plus','pro')),
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at > starts_at),
 pos_bill_limit integer check (pos_bill_limit > 0),
 room_limit integer not null check (room_limit > 0)
);
create index bite_sandbox_subscription_terms_property on private.bite_sandbox_subscription_terms(property_id,ends_at desc);
create table private.bite_sandbox_subscription_bill_usage (
 property_id uuid not null references public.bite_properties(id),
 bill_id uuid not null,
 term_id uuid not null references private.bite_sandbox_subscription_terms(receipt_id),
 bucket text not null check (bucket in ('plan','recharge','unlimited')),
 primary key(property_id,bill_id)
);
create index bite_sandbox_subscription_usage_term on private.bite_sandbox_subscription_bill_usage(term_id,bucket);
alter table private.bite_sandbox_subscription_terms enable row level security;
alter table private.bite_sandbox_subscription_bill_usage enable row level security;
revoke all on private.bite_sandbox_subscription_terms,private.bite_sandbox_subscription_bill_usage
 from public,anon,authenticated,service_role;

create function private.bite_schedule_sandbox_subscription() returns trigger
language plpgsql set search_path='' as $$
declare
 property uuid;
 start_time timestamptz;
 months integer:=(new.grant_snapshot->>'billing_months')::integer;
begin
 select property_id into strict property from private.bite_subscription_sandbox_attempts where id=new.attempt_id;
 -- Serialize purchases and bill allocation for each property.
 perform 1 from public.bite_properties where id=property for update;
 if months is null then return new; end if; -- A recharge adds credits and has no plan term.
 select greatest(new.verified_at,max(ends_at)) into start_time
 from private.bite_sandbox_subscription_terms where property_id=property;
 insert into private.bite_sandbox_subscription_terms
  (receipt_id,property_id,tier,starts_at,ends_at,pos_bill_limit,room_limit)
 values(new.attempt_id,property,new.grant_snapshot->>'tier',start_time,
  ((start_time at time zone 'Asia/Kolkata')+make_interval(months=>months)) at time zone 'Asia/Kolkata',
  (new.grant_snapshot->>'pos_bill_limit')::integer,(new.grant_snapshot->>'room_limit')::integer);
 return new;
end;
$$;
revoke all on function private.bite_schedule_sandbox_subscription() from public,anon,authenticated,service_role;
create trigger bite_schedule_sandbox_subscription after insert on private.bite_subscription_sandbox_receipts
 for each row execute function private.bite_schedule_sandbox_subscription();

create function private.bite_sandbox_recharge_balance(p_property uuid) returns bigint
language sql stable set search_path='' as $$
 select coalesce((
  select sum((r.grant_snapshot->>'extra_pos_bills')::integer) from private.bite_subscription_sandbox_receipts r
  join private.bite_subscription_sandbox_attempts a on a.id=r.attempt_id where a.property_id=p_property
 ),0)-(select count(*) from private.bite_sandbox_subscription_bill_usage
 where property_id=p_property and bucket='recharge');
$$;
revoke all on function private.bite_sandbox_recharge_balance(uuid) from public,anon,authenticated,service_role;

create function public.bite_sandbox_subscription_status(p_property uuid,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 term private.bite_sandbox_subscription_terms%rowtype;
 upcoming private.bite_sandbox_subscription_terms%rowtype;
 credits bigint;
 included_used bigint;
 current_time_utc timestamptz:=statement_timestamp();
begin
 if not exists(select from public.bite_property_members where property_id=p_property and user_id=p_actor
    and role='owner' and active) or exists(select from public.platform_admins where user_id=p_actor) then
  raise exception 'Active property Owner required' using errcode='42501';
 end if;
 select * into term from private.bite_sandbox_subscription_terms where property_id=p_property
  and starts_at<=current_time_utc and ends_at>current_time_utc order by starts_at desc limit 1;
 select * into upcoming from private.bite_sandbox_subscription_terms where property_id=p_property
  and starts_at>current_time_utc order by starts_at limit 1;
 credits:=private.bite_sandbox_recharge_balance(p_property);
 select count(*) into included_used from private.bite_sandbox_subscription_bill_usage
 where term_id=term.receipt_id and bucket='plan';
 return jsonb_build_object(
  'status',case when term.receipt_id is not null then 'active'
   when exists(select from private.bite_sandbox_subscription_terms where property_id=p_property) then 'expired'
   else 'no_plan' end,
  'tier',term.tier,'starts_at',term.starts_at,'ends_at',term.ends_at,
  'pos_bill_limit',term.pos_bill_limit,'pos_bills_remaining',term.pos_bill_limit-included_used,'room_limit',term.room_limit,
  'recharge_bills_saved',credits,'recharge_bills_available',case when term.tier='starter' then credits else 0 end,
  'next_tier',upcoming.tier,'next_starts_at',upcoming.starts_at,
  'offers',(select coalesce(jsonb_agg(to_jsonb(o)-'sale_enabled' order by o.amount_paise),'[]'::jsonb)
   from private.bite_subscription_offers o
   where o.catalog_version=(select max(catalog_version) from private.bite_subscription_offers)));
end;
$$;
revoke all on function public.bite_sandbox_subscription_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bite_sandbox_subscription_status(uuid,uuid) to service_role;

create function public.bite_meter_sandbox_subscription_bill(p_property uuid,p_bill uuid) returns text
language plpgsql security definer set search_path='' as $$
declare
 term private.bite_sandbox_subscription_terms%rowtype;
 allocation text;
 request_at timestamptz:=statement_timestamp();
begin
 if p_bill is null then raise exception 'Sandbox bill ID required' using errcode='22023'; end if;
 perform 1 from public.bite_properties where id=p_property for update;
 select bucket into allocation from private.bite_sandbox_subscription_bill_usage
 where property_id=p_property and bill_id=p_bill;
 if found then return allocation; end if;

 select * into term from private.bite_sandbox_subscription_terms
 where property_id=p_property and starts_at<=request_at and ends_at>request_at order by starts_at desc limit 1;
 if not found then return 'plan_inactive'; end if;
 if term.pos_bill_limit is null then allocation:='unlimited';
 elsif (select count(*) from private.bite_sandbox_subscription_bill_usage
        where term_id=term.receipt_id and bucket='plan')<term.pos_bill_limit then allocation:='plan';
 elsif private.bite_sandbox_recharge_balance(p_property)>0 then allocation:='recharge';
 else return 'limit_reached';
 end if;
 insert into private.bite_sandbox_subscription_bill_usage(property_id,bill_id,term_id,bucket)
 values(p_property,p_bill,term.receipt_id,allocation);
 return allocation;
end;
$$;
revoke all on function public.bite_meter_sandbox_subscription_bill(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bite_meter_sandbox_subscription_bill(uuid,uuid) to service_role;
