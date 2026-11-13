
-- Server-only V3 candidate: never called by customer web/app and does not trigger payment.
-- Coexists with the existing bite_prepare_checkout_v3 legacy-safe gate.
create function public.bite_prepare_checkout_v3_priced_candidate(
 p_restaurant_id uuid,p_delivery_type text,p_address_id uuid,
 p_customer_note text,p_lines jsonb,
 p_coupon_code text default null,p_checkout_key uuid default null
) returns uuid
language plpgsql security definer set search_path=''
as $v3$
declare
 v_customer uuid:=auth.uid();
 v_restaurant public.restaurants%rowtype;
 v_quote jsonb;
 v_subtotal numeric(12,2);
 v_fee numeric(12,2);
 v_min numeric(12,2);
 v_zone_fee numeric(12,2);
 v_zone_min numeric(12,2);
 v_time time;
 v_pin text;
 v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
 v_coupon uuid;
 v_coupon_quote jsonb;
 v_discount numeric(12,2):=0;
 v_intent uuid;
 v_commission numeric(8,2);
begin
 perform public.bite_assert_customer_can_order();
 if p_checkout_key is null then raise exception 'Checkout key required'; end if;
 if p_delivery_type not in ('delivery','pickup') then raise exception 'Invalid delivery mode'; end if;
 if p_customer_note is not null and length(p_customer_note)>500 then
   raise exception 'Order note too long';end if;
 if not exists(select 1 from public.customer_contact_profiles p where p.customer_id=v_customer
   and length(btrim(p.full_name)) between 2 and 80 and p.phone~'^[0-9]{10,15}$')
 then raise exception 'Valid customer name and phone required';end if;

 perform pg_advisory_xact_lock(hashtextextended(v_customer::text||p_checkout_key::text,0));
 select i.id into v_intent from public.bite_live_checkout_intents i
 where i.customer_id=v_customer and i.checkout_key=p_checkout_key;
 if found then
  if not exists(select 1 from public.bite_live_checkout_intents i where i.id=v_intent
    and i.restaurant_id=p_restaurant_id and i.pricing_version=3
    and i.pricing_schema_version=2 and i.delivery_type=p_delivery_type
    and i.address_id is not distinct from (case when p_delivery_type='delivery' then p_address_id else null end)
    and i.customer_note=coalesce(p_customer_note,'')
    and i.items=p_lines and coalesce(i.coupon_code,'')=v_code) then
    raise exception 'Checkout key belongs to a different cart';end if;
  return v_intent;
 end if;

 select * into v_restaurant from public.restaurants r
  where r.id=p_restaurant_id and r.is_published
    and r.status='Active' and r.onboarding_status='approved'
    and ((p_delivery_type='delivery' and r.accepts_delivery)
      or (p_delivery_type='pickup' and r.accepts_pickup));
 if not found then raise exception 'Restaurant unavailable'; end if;
 if v_restaurant.is_temporarily_closed and
    (v_restaurant.temporary_closure_until is null or v_restaurant.temporary_closure_until>now())
 then raise exception 'Restaurant temporarily closed';end if;
 if p_delivery_type='delivery' and v_restaurant.delivery_paused then
    raise exception 'Delivery paused';end if;
 v_time:=(now() at time zone 'Asia/Kolkata')::time;
 if v_restaurant.opening_time is not null and v_restaurant.closing_time is not null
    and v_restaurant.opening_time<>v_restaurant.closing_time then
   if (v_restaurant.opening_time<v_restaurant.closing_time and
      not (v_time>=v_restaurant.opening_time and v_time<v_restaurant.closing_time))
     or (v_restaurant.opening_time>v_restaurant.closing_time and
      not (v_time>=v_restaurant.opening_time or v_time<v_restaurant.closing_time))
   then raise exception 'Restaurant outside opening hours';end if;
 end if;

 -- Every amount, item name, note and option selection comes from server-side menu records.
 v_quote:=public.bite_quote_menu_options_v2(p_restaurant_id,p_lines);
 if coalesce(v_quote->>'quote_only','')<>'true'
    or coalesce(v_quote->>'authorizes_payment','')<>'false'
 then raise exception 'Untrusted menu quote';end if;
 v_subtotal:=(v_quote->>'food_subtotal')::numeric(12,2);
 if v_subtotal is null or v_subtotal<0 or v_subtotal>1000000 then
   raise exception 'Invalid subtotal';end if;

 v_fee:=case when p_delivery_type='pickup' then 0 else v_restaurant.default_delivery_fee end;
 v_min:=coalesce(v_restaurant.minimum_order_amount,0);
 if p_delivery_type='delivery' then
   select regexp_replace(coalesce(a.postal_code,''),'[^0-9]','','g') into v_pin
   from public.customer_addresses a where a.id=p_address_id and a.customer_id=v_customer;
   if v_pin is null or length(v_pin)<>6 then raise exception 'Valid saved address required';end if;
   select z.delivery_fee,z.minimum_order_amount into v_zone_fee,v_zone_min
   from public.restaurant_delivery_zone_pincodes zp
   join public.restaurant_delivery_zones z on z.id=zp.zone_id and z.restaurant_id=zp.restaurant_id
   where zp.restaurant_id=p_restaurant_id and zp.postal_code=v_pin and z.is_active limit 1;
   if not found then raise exception 'Restaurant does not deliver to this PIN';end if;
   v_fee:=v_zone_fee;v_min:=greatest(v_min,coalesce(v_zone_min,0));
 end if;
 if v_fee is null or v_fee<0 or v_subtotal<v_min then
   raise exception 'Invalid fee or below minimum order';end if;
 if v_subtotal+v_fee<1 or v_subtotal+v_fee>1000000 then
   raise exception 'Invalid payment amount';end if;

 if v_code<>'' then
   select id into v_coupon from public.bite_coupons where code=v_code;
   if v_coupon is null then raise exception 'Coupon unavailable';end if;
   perform pg_advisory_xact_lock(hashtextextended(v_coupon::text,0));
   v_coupon_quote:=public.bite_coupon_quote(p_restaurant_id,v_code,v_subtotal);
   v_discount:=(v_coupon_quote->>'discount_amount')::numeric(12,2);
 end if;
 if v_discount<0 or v_discount>v_subtotal or v_subtotal+v_fee-v_discount<1 then
   raise exception 'Invalid amount after discount';end if;

 v_commission:=coalesce(v_restaurant.platform_commission_rate,
  (select default_commission_rate from public.platform_settings limit 1),10);
 if v_commission is null or v_commission<0 or v_commission>100 then
   raise exception 'Invalid commission rate';end if;

 insert into public.bite_live_checkout_intents(
 customer_id,restaurant_id,delivery_type,address_id,customer_note,items,
 food_subtotal,delivery_fee,amount,priced_items,pricing_version,pricing_schema_version,
 variant_priced_items,coupon_id,coupon_code,discount_amount,discount_sponsor,
 checkout_key,address_snapshot,customer_snapshot,commission_rate_snapshot
 ) values (
 v_customer,p_restaurant_id,p_delivery_type,
 case when p_delivery_type='delivery' then p_address_id else null end,
 coalesce(p_customer_note,''),p_lines,
 v_subtotal,v_fee,v_subtotal+v_fee-v_discount,
 v_quote->'lines',3,2,v_quote->'lines',
 v_coupon,nullif(v_code,''),v_discount,
 case when v_coupon is not null then v_coupon_quote->>'sponsor' else null end,
 p_checkout_key,
 case when p_delivery_type='delivery' then
   (select to_jsonb(a) from public.customer_addresses a where a.id=p_address_id and a.customer_id=v_customer)
 else null end,
 (select jsonb_build_object('full_name',p.full_name,'phone',p.phone)
   from public.customer_contact_profiles p where p.customer_id=v_customer),
 v_commission
 ) returning id into v_intent;
 return v_intent;
end;
$v3$;

-- No customer, anonymous, browser, or app EXECUTE privilege.
revoke all on function public.bite_prepare_checkout_v3_priced_candidate(uuid,text,uuid,text,jsonb,text,uuid)
 from public,anon,authenticated;
grant execute on function public.bite_prepare_checkout_v3_priced_candidate(uuid,text,uuid,text,jsonb,text,uuid)
 to service_role;
