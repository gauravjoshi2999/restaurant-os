
-- Read-only preview only. NOT a payment quote and never authorises checkout.
-- Live and sandbox checkout v2 remain unchanged and cannot charge paid options.
create function public.bite_quote_menu_options_v1(
 p_restaurant_id uuid,
 p_lines jsonb
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $quote$
declare
 line jsonb;
 choice_json jsonb;
 id_item uuid;
 qty integer;
 item_name text;
 base_price numeric;
 choice_ids uuid[];
 selected_count integer;
 distinct_count integer;
 valid_count integer;
 group_count integer;
 option_cost numeric;
 item_unit numeric;
 subtotal numeric := 0;
 total_qty integer := 0;
 details jsonb;
 line_data jsonb := '[]'::jsonb;
 line_key text;
 used_keys text[] := array[]::text[];
 group_row record;
 group_picks integer;
begin
 if p_restaurant_id is null or not (
   public.is_restaurant_public(p_restaurant_id)
   or (auth.uid() is not null and (
     public.is_restaurant_member(p_restaurant_id)
     or public.is_platform_admin()
   ))
 ) then
   raise exception 'Restaurant is not available for a menu quote' using errcode='22023';
 end if;
 if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 30 then
   raise exception 'Quote must contain 1 to 30 item lines' using errcode='22023';
 end if;
 for line in select x.value from jsonb_array_elements(p_lines) as x(value) loop
   if jsonb_typeof(line) <> 'object'
       or not (line ? 'menu_item_id')
       or not (line ? 'quantity')
       or line ?| array['price','unit_price','line_total','option_price','amount'] then
      raise exception 'Invalid item shape: prices must be calculated by the server' using errcode='22023';
   end if;
   id_item := (line->>'menu_item_id')::uuid;
   qty := (line->>'quantity')::integer;
   if qty is null or qty not between 1 and 99 then
      raise exception 'Quantity must be between 1 and 99' using errcode='22023';
   end if;
   total_qty := total_qty + qty;
   if total_qty > 120 then
      raise exception 'Cart quantity limit exceeded' using errcode='22023';
   end if;
   select m.name,m.price into item_name,base_price
   from public.menu_items m
   where m.id=id_item and m.restaurant_id=p_restaurant_id and m.is_available;
   if not found or base_price is null or base_price < 0 then
      raise exception 'Menu item is unavailable' using errcode='22023';
   end if;
   choice_json := coalesce(line->'option_choice_ids','[]'::jsonb);
   if jsonb_typeof(choice_json) <> 'array' or jsonb_array_length(choice_json)>24 then
      raise exception 'Invalid option choice list' using errcode='22023';
   end if;
   select coalesce(array_agg(x.val::uuid order by x.val),array[]::uuid[])
    into choice_ids from jsonb_array_elements_text(choice_json) as x(val);
   selected_count := cardinality(choice_ids);
   select count(distinct x.val) into distinct_count from unnest(choice_ids) as x(val);
   if selected_count <> distinct_count then
      raise exception 'Duplicate option choices are not allowed' using errcode='22023';
   end if;
   line_key := id_item::text || '|' || array_to_string(choice_ids,',');
   if line_key = any(used_keys) then
      raise exception 'Duplicate menu selection: merge the quantities into one line' using errcode='22023';
   end if;
   used_keys := array_append(used_keys,line_key);
   select count(*),coalesce(sum(c.price_delta),0),
      coalesce(jsonb_agg(jsonb_build_object(
       'choice_id',c.id,'group_id',g.id,'group_name',g.name,
       'name',c.name,'price_delta',c.price_delta
      ) order by c.id::text),'[]'::jsonb)
   into valid_count,option_cost,details
   from public.menu_option_choices c
   join public.menu_option_groups g on g.restaurant_id=c.restaurant_id
      and g.id=c.option_group_id and g.is_available
   join public.menu_item_option_groups link on link.restaurant_id=c.restaurant_id
      and link.option_group_id=c.option_group_id
      and link.menu_item_id=id_item and link.is_available
   where c.restaurant_id=p_restaurant_id and c.is_available
      and c.id=any(choice_ids);
   if valid_count <> selected_count then
      raise exception 'One or more options are unavailable for this restaurant item'
        using errcode='22023';
   end if;
   for group_row in
     select g.id,g.min_select,g.max_select,g.name
     from public.menu_item_option_groups link
     join public.menu_option_groups g
       on g.restaurant_id=link.restaurant_id and g.id=link.option_group_id
     where link.restaurant_id=p_restaurant_id
       and link.menu_item_id=id_item
       and link.is_available and g.is_available
   loop
     select count(*) into group_picks
       from public.menu_option_choices c
       where c.restaurant_id=p_restaurant_id
         and c.option_group_id=group_row.id and c.id=any(choice_ids)
         and c.is_available;
     if group_picks < group_row.min_select or group_picks > group_row.max_select then
       raise exception 'Selection limit not met for option group %',group_row.name
         using errcode='22023';
     end if;
   end loop;
   item_unit := round(base_price+option_cost,2);
   subtotal := subtotal+round(item_unit*qty,2);
   if subtotal > 1000000 then
     raise exception 'Cart total limit exceeded' using errcode='22023';
   end if;
   line_data := line_data || jsonb_build_array(jsonb_build_object(
     'line_key',line_key,'menu_item_id',id_item,'item_name',item_name,
     'quantity',qty,'base_unit_price',base_price,'options',details,
     'option_unit_total',option_cost,'final_unit_price',item_unit,
     'line_total',round(item_unit*qty,2)
   ));
 end loop;
 return jsonb_build_object(
   'restaurant_id',p_restaurant_id,'currency','INR',
   'quote_only',true,'authorizes_payment',false,
   'lines',line_data,'food_subtotal',round(subtotal,2)
 );
end;
$quote$;

revoke all on function public.bite_quote_menu_options_v1(uuid,jsonb) from public;
grant execute on function public.bite_quote_menu_options_v1(uuid,jsonb)
 to anon,authenticated,service_role;
