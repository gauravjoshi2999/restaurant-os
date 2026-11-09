-- Non-destructive deep-QA corrections; existing business data and grants are retained.

CREATE OR REPLACE FUNCTION public.enforce_single_restaurant_owner_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.restaurant_id = old.restaurant_id
     and new.user_id = old.user_id
     and new.role = old.role then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.restaurant_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('owner-user:' || new.user_id::text, 0));

  if exists (
    select 1 from public.platform_admins pa where pa.user_id = new.user_id
  ) then
    raise exception 'A Platform Admin account cannot also be assigned as a Restaurant Owner.';
  end if;

  if exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = new.restaurant_id
      and rm.role = 'owner'
      and rm.user_id <> new.user_id
  ) then
    raise exception 'This restaurant already has an Owner account. Resolve the existing Owner mapping before assigning another.';
  end if;

  if exists (
    select 1 from public.restaurant_members rm
    where rm.user_id = new.user_id and rm.role = 'owner'
      and rm.restaurant_id <> new.restaurant_id
  ) then
    raise exception 'This Owner account is already assigned to another restaurant. Resolve the existing Owner mapping first.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bite_prepare_live_checkout(p_restaurant_id uuid, p_delivery_type text, p_address_id uuid, p_customer_note text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=auth.uid();v_item jsonb;v_menu public.menu_items%rowtype;v_qty integer;v_total numeric(12,2):=0;v_fee numeric(12,2):=0;v_min numeric(12,2):=0;v_zone_fee numeric(12,2);v_zone_min numeric(12,2);v_pin text;v_id uuid;v_priced jsonb:='[]'::jsonb;v_restaurant public.restaurants%rowtype;v_local_time time;
begin
 if v_user is null then raise exception 'Login required';end if;
 if p_delivery_type not in ('pickup','delivery') then raise exception 'Invalid delivery type';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid cart';end if;
 select r.minimum_order_amount,case when p_delivery_type='delivery' then r.default_delivery_fee else 0 end into v_min,v_fee from public.restaurants r where r.id=p_restaurant_id and r.status='Active' and r.onboarding_status='approved' and r.is_published and ((p_delivery_type='delivery' and r.accepts_delivery) or (p_delivery_type='pickup' and r.accepts_pickup));
 if not found then raise exception 'Restaurant unavailable';end if;
 select * into v_restaurant from public.restaurants where id=p_restaurant_id;
 if v_restaurant.is_temporarily_closed and (v_restaurant.temporary_closure_until is null or v_restaurant.temporary_closure_until>now()) then raise exception 'Restaurant is temporarily closed';end if;
 if p_delivery_type='delivery' and v_restaurant.delivery_paused then raise exception 'Delivery is paused; choose pickup if available';end if;
 v_local_time:=(now() at time zone 'Asia/Kolkata')::time;
 if v_restaurant.opening_time is not null and v_restaurant.closing_time is not null and v_restaurant.opening_time<>v_restaurant.closing_time then
  if (v_restaurant.opening_time<v_restaurant.closing_time and not (v_local_time>=v_restaurant.opening_time and v_local_time<v_restaurant.closing_time))
   or (v_restaurant.opening_time>v_restaurant.closing_time and not (v_local_time>=v_restaurant.opening_time or v_local_time<v_restaurant.closing_time)) then
   raise exception 'Restaurant is outside its opening hours';
  end if;
 end if;
 if p_delivery_type='delivery' then
  select regexp_replace(coalesce(a.postal_code,''),'[^0-9]','','g') into v_pin from public.customer_addresses a where a.id=p_address_id and a.customer_id=v_user;
  if v_pin is null or length(v_pin)<>6 then raise exception 'Valid saved delivery address required';end if;
  select z.delivery_fee,z.minimum_order_amount into v_zone_fee,v_zone_min from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id and z.restaurant_id=zp.restaurant_id where zp.restaurant_id=p_restaurant_id and zp.postal_code=v_pin and z.is_active limit 1;
  if not found then raise exception 'Restaurant does not deliver to this PIN';end if;
  v_fee:=v_zone_fee;v_min:=greatest(v_min,v_zone_min);
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item)<>'object' or (v_item->>'quantity') !~ '^[0-9]{1,2}$' or (v_item->>'menu_item_id') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid cart item';end if;
  v_qty:=(v_item->>'quantity')::integer;
  if v_qty<1 or v_qty>99 then raise exception 'Invalid quantity';end if;
  select * into v_menu from public.menu_items where id=(v_item->>'menu_item_id')::uuid and restaurant_id=p_restaurant_id and is_available;
  if not found then raise exception 'Item unavailable';end if;
  v_total:=v_total+round(v_qty*v_menu.price,2);v_priced:=v_priced||jsonb_build_array(jsonb_build_object('menu_item_id',v_menu.id,'item_name',v_menu.name,'quantity',v_qty,'unit_price',v_menu.price));
 end loop;
 if v_total<v_min then raise exception 'Below minimum order';end if;
 if v_total+v_fee<1 or v_total+v_fee>1000000 then raise exception 'Invalid amount';end if;
 insert into public.bite_live_checkout_intents(customer_id,restaurant_id,delivery_type,address_id,customer_note,items,food_subtotal,delivery_fee,amount,priced_items)
 values(v_user,p_restaurant_id,p_delivery_type,case when p_delivery_type='delivery' then p_address_id else null end,left(coalesce(p_customer_note,''),500),p_items,v_total,v_fee,v_total+v_fee,v_priced) returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.bite_finalize_verified_live_checkout(p_intent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.bite_live_checkout_intents%rowtype; v_order uuid; v_item jsonb; v_menu public.menu_items%rowtype; v_profile public.customer_contact_profiles%rowtype; v_address jsonb; v_rate numeric(8,2); v_code text;v_snapshot_total numeric(12,2):=0;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found then raise exception 'Intent missing';end if;
 if v.status='activated' then return v.activated_order_id;end if;
 if v.status<>'payment_verified' or v.provider_order_id is null then raise exception 'Verified payment required';end if;
 if v.delivery_type not in ('pickup','delivery') or v.priced_items is null or jsonb_typeof(v.priced_items)<>'array' or jsonb_array_length(v.priced_items) not between 1 and 50 then raise exception 'Invalid checkout snapshot';end if;
 if v.food_subtotal is null or v.delivery_fee is null or v.food_subtotal+v.delivery_fee<>v.amount then raise exception 'Checkout totals inconsistent';end if;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop
 if (v_item->>'quantity') !~ '^[0-9]{1,2}$' or (v_item->>'unit_price') !~ '^[0-9]+([.][0-9]{1,2})?$' or nullif(v_item->>'item_name','') is null then raise exception 'Invalid priced snapshot';end if;
 v_snapshot_total:=v_snapshot_total+round((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric,2);
 end loop;
 if v_snapshot_total<>v.food_subtotal then raise exception 'Snapshot total mismatch';end if;
 select * into v_profile from public.customer_contact_profiles where customer_id=v.customer_id;
 if v.delivery_type='delivery' then
 select to_jsonb(a) into v_address from public.customer_addresses a where a.id=v.address_id and a.customer_id=v.customer_id;
 if v_address is null then raise exception 'Delivery address missing';end if;
 end if;
 select coalesce((select r.platform_commission_rate from public.restaurants r where r.id=v.restaurant_id),(select ps.default_commission_rate from public.platform_settings ps limit 1),10) into v_rate;
 if v_rate is null or v_rate<0 or v_rate>100 then raise exception 'Invalid commission rate';end if;
 v_code:='BITE-'||upper(substr(replace(v.id::text,'-',''),1,12));
 insert into public.orders(restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,customer_phone,delivery_type,delivery_address_snapshot,customer_note,is_demo)
 values(v.restaurant_id,v_code,'Own Platform',v.amount,'Received',v.customer_id,v.customer_id,coalesce(nullif(v_profile.full_name,''),'Customer'),v_profile.phone,v.delivery_type,v_address,v.customer_note,false) returning id into v_order;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop
 
 insert into public.order_items(order_id,item_name,quantity,unit_price)
 values(v_order,v_item->>'item_name',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
 end loop;
 if (select coalesce(sum(line_total),0) from public.order_items where order_id=v_order)<>v.food_subtotal then raise exception 'Menu prices changed; manual reconciliation required';end if;
 insert into public.order_financials(order_id,restaurant_id,channel,food_subtotal,commissionable_food_value,commission_rate,commission_amount,delivery_fee,customer_payable_amount,payment_status,created_by,is_demo)
 values(v_order,v.restaurant_id,'Own Platform',v.food_subtotal,v.food_subtotal,v_rate,round(v.food_subtotal*v_rate/100,2),v.delivery_fee,v.amount,'paid',v.customer_id,false);
 update public.bite_live_checkout_intents set status='activated',activated_order_id=v_order,updated_at=now() where id=p_intent_id;
 return v_order;
end $function$;


-- Cover the five new payment/draft foreign keys reported by the performance advisor.
CREATE INDEX IF NOT EXISTS bite_live_checkout_address_idx ON public.bite_live_checkout_intents(address_id);
CREATE INDEX IF NOT EXISTS bite_live_checkout_customer_idx ON public.bite_live_checkout_intents(customer_id);
CREATE INDEX IF NOT EXISTS bite_live_checkout_restaurant_idx ON public.bite_live_checkout_intents(restaurant_id);
CREATE INDEX IF NOT EXISTS bite_sandbox_draft_customer_idx ON public.bite_sandbox_order_drafts(customer_id);
CREATE INDEX IF NOT EXISTS bite_sandbox_draft_restaurant_idx ON public.bite_sandbox_order_drafts(restaurant_id);
