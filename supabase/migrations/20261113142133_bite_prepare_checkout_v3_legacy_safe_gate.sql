
-- V3 contract introduction with a hard paid-options gate until payment finalizer supports snapshots.
-- Existing V2 remains untouched. No client-supplied prices are accepted.
create function public.bite_prepare_checkout_v3(
  p_restaurant_id uuid,
  p_delivery_type text,
  p_address_id uuid,
  p_customer_note text,
  p_lines jsonb,
  p_coupon_code text default null,
  p_checkout_key uuid default null
)
returns uuid
language plpgsql security invoker set search_path=''
as $body$
declare
  v_line jsonb;
  v_option_ids jsonb;
  v_item_id uuid;
  v_qty integer;
  v_items jsonb := '[]'::jsonb;
  v_seen uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Login required' using errcode='28000';
  end if;
  if p_checkout_key is null then
    raise exception 'Checkout key required' using errcode='22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array'
      or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'Invalid cart' using errcode='22023';
  end if;
  for v_line in select el.value from jsonb_array_elements(p_lines) el(value) loop
    if jsonb_typeof(v_line)<>'object'
      or not (v_line ? 'menu_item_id') or not (v_line ? 'quantity')
      or (v_line - 'menu_item_id' - 'quantity' - 'option_choice_ids') <> '{}'::jsonb then
       raise exception 'Unsupported cart line fields' using errcode='22023';
    end if;
    if (v_line->>'menu_item_id') !~ '^[0-9a-fA-F-]{36}$'
       or (v_line->>'quantity') !~ '^[0-9]{1,2}$' then
      raise exception 'Invalid cart line' using errcode='22023';
    end if;
    v_item_id := (v_line->>'menu_item_id')::uuid;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty <1 or v_qty>99 or v_item_id=any(v_seen) then
      raise exception 'Invalid or duplicate cart item' using errcode='22023';
    end if;
    v_seen:=array_append(v_seen,v_item_id);
    v_option_ids:=coalesce(v_line->'option_choice_ids','[]'::jsonb);
    if jsonb_typeof(v_option_ids)<>'array' then
      raise exception 'Invalid option choices' using errcode='22023';
    end if;
    if jsonb_array_length(v_option_ids)>0 then
      raise exception 'Paid options checkout is not enabled until verified V3 payment snapshots are deployed'
        using errcode='0A000';
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('menu_item_id',v_item_id,'quantity',v_qty));
  end loop;
  -- Delegates all order, coupon, delivery-zone, idempotency and amount validation to trusted V2.
  return public.bite_prepare_checkout_v2(
    p_restaurant_id,p_delivery_type,p_address_id,p_customer_note,
    v_items,p_coupon_code,p_checkout_key
  );
end;
$body$;

revoke all on function public.bite_prepare_checkout_v3(uuid,text,uuid,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.bite_prepare_checkout_v3(uuid,text,uuid,text,jsonb,text,uuid) to authenticated;
comment on function public.bite_prepare_checkout_v3(uuid,text,uuid,text,jsonb,text,uuid)
  is 'V3 contract guard only. Legacy option-free cart delegates to production V2; any priced options fail closed until V3 finalizer and checkout payment parity are ready.';
