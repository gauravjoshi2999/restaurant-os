-- POS Stage 2: a single bill with explicit dine-in/takeaway and actual people served.
-- Never infer counts from order-item quantities or old sales.
-- Existing POS orders, payments, hotel room folios and provider settlement are unchanged.

create table if not exists public.restaurant_pos_visit_details (
 order_id uuid primary key references public.orders(id) on delete restrict,
 restaurant_id uuid not null references public.restaurants(id),
 visit_type text not null check (visit_type in ('dine_in','takeaway')),
 guest_count integer,
 recorded_by uuid not null,
 created_at timestamptz not null default now(),
 constraint bite_pos_visit_guest_count_valid check (
  (visit_type='dine_in' and guest_count is not null and guest_count between 1 and 200)
  or (visit_type='takeaway' and guest_count is null)
 )
);

create index if not exists idx_pos_visits_restaurant_created
 on public.restaurant_pos_visit_details(restaurant_id,created_at desc);

alter table public.restaurant_pos_visit_details enable row level security;
revoke all on public.restaurant_pos_visit_details from public,anon,authenticated;
grant select,insert on public.restaurant_pos_visit_details to authenticated;

drop policy if exists pos_visits_members_read on public.restaurant_pos_visit_details;
create policy pos_visits_members_read on public.restaurant_pos_visit_details
 for select to authenticated
 using (public.is_restaurant_member(restaurant_id));

drop policy if exists pos_visits_actor_create_on_own_new_order on public.restaurant_pos_visit_details;
create policy pos_visits_actor_create_on_own_new_order on public.restaurant_pos_visit_details
 for insert to authenticated
 with check (
  recorded_by=(select auth.uid())
  and public.has_restaurant_role(restaurant_id,array['owner','manager','staff'])
  and exists (
   select 1 from public.orders o
   where o.id=order_id and o.restaurant_id=restaurant_id
    and o.created_by=(select auth.uid())
    and o.channel like 'POS - %' and not coalesce(o.is_demo,false)
    and o.created_at >= now()-interval '5 minutes'
  )
 );

-- The existing owner balance/Khata and payment RPCs are reused as-is, inside
-- one transaction that also records the immutable visit metadata.
create or replace function public.bite_create_counter_pos_visit_v1(
 p_restaurant_id uuid,
 p_visit_type text,
 p_guest_count integer,
 p_payload jsonb
) returns uuid language plpgsql security invoker
set search_path = '' as $function$
declare
 v_order uuid;
 v_original uuid;
 v_code text;
begin
 if auth.uid() is null or not public.has_restaurant_role(
   p_restaurant_id,array['owner','manager']
 ) then
  raise exception 'Authorized POS owner or manager required' using errcode='42501';
 end if;
 if p_visit_type not in ('dine_in','takeaway') or p_visit_type is null
    or (p_visit_type='dine_in' and (p_guest_count is null or p_guest_count not between 1 and 200))
    or (p_visit_type='takeaway' and p_guest_count is not null) then
  raise exception 'Choose Dine-in with 1–200 people or Takeaway without guests' using errcode='22023';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'POS bill details required' using errcode='22023';
 end if;
 v_code:=nullif(trim(p_payload->>'order_code'),'');
 if v_code is null or length(v_code)>100 then
  raise exception 'Valid bill reference required' using errcode='22023';
 end if;
 v_original:=nullif(p_payload->>'original_order_id','')::uuid;
 if v_original is null then
  v_order:=public.create_pos_order_with_balance_action(
   p_restaurant_id,v_code,
   coalesce(p_payload->>'customer_name',''),
   coalesce(p_payload->>'customer_phone',''),
   p_payload->'items',
   (p_payload->>'paid_amount')::numeric,
   p_payload->>'payment_method',
   (p_payload->>'payment_date')::date,
   p_payload->>'reference',
   p_payload->>'balance_action',
   p_payload->>'writeoff_reason'
  );
 else
  v_order:=public.replace_unpaid_pos_order(
   v_original,p_restaurant_id,v_code,
   coalesce(p_payload->>'customer_name',''),
   coalesce(p_payload->>'customer_phone',''),
   p_payload->'items',
   (p_payload->>'paid_amount')::numeric,
   p_payload->>'payment_method',
   (p_payload->>'payment_date')::date,
   p_payload->>'reference',
   p_payload->>'balance_action',
   p_payload->>'writeoff_reason'
  );
 end if;
 insert into public.restaurant_pos_visit_details
  (order_id,restaurant_id,visit_type,guest_count,recorded_by)
 values (v_order,p_restaurant_id,p_visit_type,p_guest_count,auth.uid());
 return v_order;
end;
$function$;
revoke all on function public.bite_create_counter_pos_visit_v1(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.bite_create_counter_pos_visit_v1(uuid,text,integer,jsonb) to authenticated,service_role;

-- Property-linked cashier/owner bills already use the idempotent
-- bite_property_command(p_request) pathway. Its own commit also inserts a
-- property-command audit row; this trigger attaches visits within the SAME
-- transaction and does not alter that protected financial procedure.
create or replace function private.bite_pos_visit_from_property_command_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
 v_restaurant uuid;
 v_order uuid;
 v_creator uuid;
 v_channel text;
 v_visit text;
 v_count integer;
begin
 if new.action <> 'pos_sale' or not (new.payload ? 'pos_visit_type') then
  return new;
 end if;
 v_visit:=new.payload->>'pos_visit_type';
 if v_visit is null or v_visit not in('dine_in','takeaway') then
  raise exception 'Valid restaurant POS service type required' using errcode='22023';
 end if;
 if v_visit='dine_in' then
  if new.payload->>'guest_count' is null
     or (new.payload->>'guest_count')!~'^[0-9]{1,3}$' then
   raise exception 'Enter an integer number of dine-in guests' using errcode='22023';
  end if;
  v_count:=(new.payload->>'guest_count')::integer;
  if v_count not between 1 and 200 then
   raise exception 'Dine-in people must be between 1 and 200' using errcode='22023';
  end if;
 elsif new.payload ? 'guest_count' and new.payload->'guest_count'<>'null'::jsonb then
  raise exception 'Takeaway does not count seated restaurant guests' using errcode='22023';
 end if;
 v_restaurant:=(new.payload->>'restaurant_id')::uuid;
 v_order:=(new.result->>'order_id')::uuid;
 select o.created_by,o.channel into v_creator,v_channel from public.orders o
 where o.id=v_order and o.restaurant_id=v_restaurant
  and o.order_code='POS-'||new.request_id::text
  and o.created_at>now()-interval '5 minutes';
 if not found or v_creator is distinct from new.created_by
    or v_channel is distinct from
      case when v_visit='dine_in' then 'POS - Dine-in' else 'POS - Takeaway' end
    or not exists (
      select 1 from public.bite_property_outlets l
      where l.property_id=new.property_id and l.restaurant_id=v_restaurant
    ) then
  raise exception 'POS property visit does not match committed sale' using errcode='42501';
 end if;
 insert into public.restaurant_pos_visit_details
  (order_id,restaurant_id,visit_type,guest_count,recorded_by)
 values (v_order,v_restaurant,v_visit,v_count,new.created_by);
 return new;
end;
$function$;
revoke all on function private.bite_pos_visit_from_property_command_v1() from public,anon,authenticated;
drop trigger if exists bite_pos_visit_on_property_command_v1 on public.bite_property_commands;
create trigger bite_pos_visit_on_property_command_v1
 after insert on public.bite_property_commands
 for each row when (new.action='pos_sale')
 execute function private.bite_pos_visit_from_property_command_v1();

comment on table public.restaurant_pos_visit_details is
'Actual dine-in diner counts and takeaway classification for new POS orders only; excludes estimated historical headcounts.';
