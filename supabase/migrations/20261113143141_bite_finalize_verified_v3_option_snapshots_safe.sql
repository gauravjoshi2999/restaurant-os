do $precondition$
begin
 if position('insert into public.order_items(order_id,item_name,quantity,unit_price,menu_item_id)' in
   pg_get_functiondef('public.bite_finalize_verified_live_checkout(uuid)'::regprocedure))=0
 then raise exception 'Checkout finalizer changed concurrently: manual review required';end if;
end
$precondition$;
CREATE OR REPLACE FUNCTION public.bite_finalize_verified_live_checkout(p_intent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.bite_live_checkout_intents%rowtype; v_order uuid; v_item jsonb; v_menu public.menu_items%rowtype; v_profile public.customer_contact_profiles%rowtype; v_address jsonb; v_rate numeric(8,2); v_code text;v_snapshot_total numeric(12,2):=0; v_option_sum numeric(12,2);
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found then raise exception 'Intent missing';end if;
 if v.status='activated' then return v.activated_order_id;end if;
 if v.status<>'payment_verified' or v.provider_order_id is null then raise exception 'Verified payment required';end if;
 if v.delivery_type not in ('pickup','delivery') or v.priced_items is null or jsonb_typeof(v.priced_items)<>'array' or jsonb_array_length(v.priced_items) not between 1 and 50 then raise exception 'Invalid checkout snapshot';end if;
 if v.food_subtotal is null or v.delivery_fee is null or v.food_subtotal+v.delivery_fee-v.discount_amount<>v.amount or v.discount_amount>v.food_subtotal then raise exception 'Checkout totals inconsistent';end if;
 if v.pricing_version=3 and
  (v.pricing_schema_version<>2 or v.variant_priced_items is distinct from v.priced_items)
 then raise exception 'Verified V3 checkout snapshot versions do not match';end if;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop
 if (v_item->>'quantity') !~ '^[0-9]{1,2}$' or (v_item->>'unit_price') !~ '^[0-9]+([.][0-9]{1,2})?$' or nullif(v_item->>'item_name','') is null then raise exception 'Invalid priced snapshot';end if;
 if v.pricing_version=3 then
  if jsonb_typeof(v_item->'options')<>'array'
   or coalesce(length(v_item->>'line_key'),0) not between 1 and 1024
   or length(coalesce(v_item->>'note',''))>100
   or (v_item->>'base_unit_price') is null
   or (v_item->>'option_unit_total') is null
  then raise exception 'Invalid V3 option snapshot structure';end if;
  select coalesce(sum((o.value->>'price_delta')::numeric),0)
    into v_option_sum from jsonb_array_elements(v_item->'options') as o(value);
  if v_option_sum<>(v_item->>'option_unit_total')::numeric
   or (v_item->>'base_unit_price')::numeric+(v_item->>'option_unit_total')::numeric
      <>(v_item->>'unit_price')::numeric
   or v_option_sum<0
  then raise exception 'V3 priced option snapshot mismatch';end if;
 end if;
 v_snapshot_total:=v_snapshot_total+round((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric,2);
 end loop;
 if v_snapshot_total<>v.food_subtotal then raise exception 'Snapshot total mismatch';end if;
 select * into v_profile from public.customer_contact_profiles where customer_id=v.customer_id;
 if v.customer_snapshot is not null then v_profile.full_name:=v.customer_snapshot->>'full_name';v_profile.phone:=v.customer_snapshot->>'phone';end if;
 if v.delivery_type='delivery' then
 v_address:=v.address_snapshot;
 if v_address is null then select to_jsonb(a) into v_address from public.customer_addresses a where a.id=v.address_id and a.customer_id=v.customer_id;end if;
 if v_address is null then raise exception 'Delivery address missing';end if;
 end if;
 select coalesce(v.commission_rate_snapshot,(select r.platform_commission_rate from public.restaurants r where r.id=v.restaurant_id),(select ps.default_commission_rate from public.platform_settings ps limit 1),10) into v_rate;
 if v_rate is null or v_rate<0 or v_rate>100 then raise exception 'Invalid commission rate';end if;
 v_code:='BITE-'||upper(substr(replace(v.id::text,'-',''),1,12));
 perform set_config('app.verified_checkout_activation','true',true);
 insert into public.orders(restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,customer_phone,delivery_type,delivery_address_snapshot,customer_note,is_demo)
 values(v.restaurant_id,v_code,'Own Platform',v.amount,'Received',v.customer_id,v.customer_id,coalesce(nullif(v_profile.full_name,''),'Customer'),v_profile.phone,v.delivery_type,v_address,v.customer_note,false) returning id into v_order;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop

 insert into public.order_items(
  order_id,item_name,quantity,unit_price,menu_item_id,
  option_choices_snapshot,base_unit_price_snapshot,option_unit_total_snapshot,
  cart_line_key_snapshot,cooking_request_snapshot,
  selected_options_snapshot,base_unit_price,option_unit_total,variant_line_key,cooking_request
 )
 values(
  v_order,v_item->>'item_name',(v_item->>'quantity')::numeric,
  (v_item->>'unit_price')::numeric,
  (select m.id from public.menu_items m where m.id=(v_item->>'menu_item_id')::uuid and m.restaurant_id=v.restaurant_id),
  case when v.pricing_version=3 then v_item->'options' else '[]'::jsonb end,
  case when v.pricing_version=3 then (v_item->>'base_unit_price')::numeric else null end,
  case when v.pricing_version=3 then (v_item->>'option_unit_total')::numeric else 0 end,
  case when v.pricing_version=3 then v_item->>'line_key' else null end,
  case when v.pricing_version=3 then v_item->>'note' else null end,
  case when v.pricing_version=3 then v_item->'options' else '[]'::jsonb end,
  case when v.pricing_version=3 then (v_item->>'base_unit_price')::numeric else null end,
  case when v.pricing_version=3 then (v_item->>'option_unit_total')::numeric else null end,
  case when v.pricing_version=3 then v_item->>'line_key' else null end,
  case when v.pricing_version=3 then v_item->>'note' else null end
 );
 end loop;
 if (select coalesce(sum(line_total),0) from public.order_items where order_id=v_order)<>v.food_subtotal then raise exception 'Menu prices changed; manual reconciliation required';end if;
 insert into public.order_financials(order_id,restaurant_id,channel,food_subtotal,restaurant_discount,platform_discount,coupon_code,commissionable_food_value,commission_rate,commission_amount,delivery_fee,customer_payable_amount,payment_status,created_by,is_demo)
 values(v_order,v.restaurant_id,'Own Platform',v.food_subtotal,case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,case when v.discount_sponsor='platform' then v.discount_amount else 0 end,v.coupon_code,v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,v_rate,round((v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end)*v_rate/100,2),v.delivery_fee,v.amount,'paid',v.customer_id,false);
 update public.bite_live_checkout_intents set status='activated',activated_order_id=v_order,updated_at=now() where id=p_intent_id;
 return v_order;
end $function$;