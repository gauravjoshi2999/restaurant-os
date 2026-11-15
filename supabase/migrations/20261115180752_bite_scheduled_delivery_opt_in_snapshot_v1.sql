-- Scheduled delivery v1: owner opt-in, request window (not guaranteed ETA).
alter table public.restaurants add column if not exists accepts_scheduled_delivery boolean not null default false;
alter table public.restaurants add column if not exists scheduled_lead_minutes integer not null default 90;
alter table public.restaurants add column if not exists scheduled_horizon_days integer not null default 3;
alter table public.restaurants drop constraint if exists bite_scheduled_lead_range;
alter table public.restaurants add constraint bite_scheduled_lead_range check (scheduled_lead_minutes between 30 and 480);
alter table public.restaurants drop constraint if exists bite_scheduled_horizon_range;
alter table public.restaurants add constraint bite_scheduled_horizon_range check (scheduled_horizon_days between 1 and 7);
alter table public.bite_live_checkout_intents add column if not exists scheduled_for timestamptz;
alter table public.orders add column if not exists scheduled_for timestamptz;

-- Owner-approved restaurant schedules only; no fabricated slot availability.
create or replace function public.bite_validate_scheduled_delivery_v1(
 p_restaurant_id uuid,p_scheduled_for timestamptz
) returns boolean language plpgsql security definer set search_path=''
as $fn$
declare
 r public.restaurants%rowtype;
 t time;
 slot_m integer;open_m integer;close_m integer;
begin
 if auth.uid() is null then raise exception 'Customer login required';end if;
 if p_scheduled_for is null then raise exception 'Select a delivery slot';end if;
 select * into r from public.restaurants where id=p_restaurant_id and status='Active'
  and onboarding_status='approved' and is_published and accepts_delivery
  and accepts_scheduled_delivery and not delivery_paused;
 if not found then raise exception 'This restaurant does not accept scheduled delivery';end if;
 if r.is_temporarily_closed and (r.temporary_closure_until is null or r.temporary_closure_until>p_scheduled_for)
 then raise exception 'Restaurant temporarily closed for selected time';end if;
 if p_scheduled_for<now()+(r.scheduled_lead_minutes||' minutes')::interval
    or p_scheduled_for>now()+(r.scheduled_horizon_days||' days')::interval
 then raise exception 'Selected delivery time is outside the available schedule window';end if;
 if r.opening_time is null or r.closing_time is null or r.opening_time=r.closing_time
 then raise exception 'Scheduling needs published restaurant opening and closing hours';end if;
 t:=(p_scheduled_for at time zone 'Asia/Kolkata')::time;
 if extract(second from t)<>0 or mod(extract(minute from t)::integer,30)<>0 then
   raise exception 'Choose a 30-minute delivery slot';end if;
 slot_m:=extract(hour from t)::integer*60+extract(minute from t)::integer;
 open_m:=extract(hour from r.opening_time)::integer*60+extract(minute from r.opening_time)::integer;
 close_m:=extract(hour from r.closing_time)::integer*60+extract(minute from r.closing_time)::integer;
 if open_m<close_m then
   if slot_m<open_m or slot_m+30>close_m then raise exception 'Slot outside restaurant hours';end if;
 else
   if not ((slot_m>=open_m and slot_m+30<=1440+close_m) or
           (slot_m<close_m and slot_m+30<=close_m))
   then raise exception 'Slot outside restaurant hours';end if;
 end if;
 return true;
end;$fn$;
revoke all on function public.bite_validate_scheduled_delivery_v1(uuid,timestamptz)
 from public,anon;
grant execute on function public.bite_validate_scheduled_delivery_v1(uuid,timestamptz) to authenticated;

-- Keep legacy online checkout idempotency and priced-intent verification unchanged.
create or replace function public.bite_prepare_scheduled_checkout_v1(
 p_restaurant_id uuid,p_delivery_type text,p_address_id uuid,
 p_customer_note text,p_items jsonb,p_coupon_code text default null,
 p_checkout_key uuid default null,p_scheduled_for timestamptz default null
) returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_id uuid;v_intent public.bite_live_checkout_intents%rowtype;
begin
 if auth.uid() is null then raise exception 'Customer login required';end if;
 if p_delivery_type<>'delivery' then raise exception 'Only delivery can be scheduled';end if;
 if p_checkout_key is null then raise exception 'Checkout key required';end if;
 perform public.bite_validate_scheduled_delivery_v1(p_restaurant_id,p_scheduled_for);
 v_id:=public.bite_prepare_checkout_v2(p_restaurant_id,p_delivery_type,p_address_id,p_customer_note,
   p_items,p_coupon_code,p_checkout_key);
 select * into v_intent from public.bite_live_checkout_intents where id=v_id and customer_id=auth.uid()
  and restaurant_id=p_restaurant_id for update;
 if not found or v_intent.status<>'awaiting_payment' or v_intent.provider_attempted_at is not null
     or v_intent.provider_order_id is not null
 then raise exception 'Scheduled checkout is already being paid or no longer editable';end if;
 if v_intent.scheduled_for is not null and v_intent.scheduled_for<>p_scheduled_for then
   raise exception 'Checkout key belongs to another delivery slot';end if;
 update public.bite_live_checkout_intents set scheduled_for=p_scheduled_for where id=v_id;
 return v_id;
end;$fn$;
revoke all on function public.bite_prepare_scheduled_checkout_v1(uuid,text,uuid,text,jsonb,text,uuid,timestamptz)
 from public,anon;
grant execute on function public.bite_prepare_scheduled_checkout_v1(uuid,text,uuid,text,jsonb,text,uuid,timestamptz)
 to authenticated;

-- Propagate the immutable paid intent's selected time into the verified order.
-- Preserve payment amount, snapshots, receipt, and refund code exactly as-is.
do $upgrade$
declare v_definition text;
begin
 select pg_get_functiondef('public.bite_finalize_verified_live_checkout(uuid)'::regprocedure)
 into v_definition;
 if position('v.scheduled_for' in v_definition)=0 then
  if position('customer_note,is_demo)' in v_definition)=0
     or position('v.customer_note,false) returning id into v_order;' in v_definition)=0
  then raise exception 'Unexpected verified-order function: refusing to change schedule snapshot';end if;
  v_definition:=replace(v_definition,
    'customer_note,is_demo)','customer_note,is_demo,scheduled_for)');
  v_definition:=replace(v_definition,
    'v.customer_note,false) returning id into v_order;',
    'v.customer_note,false,v.scheduled_for) returning id into v_order;');
  execute v_definition;
 end if;
end;$upgrade$;