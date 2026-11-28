-- Rehearsal candidate. Apply after the four menu channel columns.
create function private.bite_pos_catalog_item(p_restaurant_id uuid,p_item_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare
 item_id uuid;
 room_bill boolean;
begin
 if p_item_id is null then return null; end if;
 -- The existing property command sets this scope after granting room charging
 -- and restores it on return. Verify the scope belongs to this outlet.
 select exists (
  select 1 from public.bite_property_outlets outlet
  where outlet.restaurant_id=p_restaurant_id
   and outlet.property_id::text=current_setting('bite.staff_room_charge_scope',true)
 ) into room_bill;

 select item.id into item_id
 from public.menu_items item
 where item.id=p_item_id and item.restaurant_id=p_restaurant_id and item.is_available
  and case when room_bill then item.available_room else item.available_pos end
 for share;
 if item_id is null then
  raise exception 'A selected dish is unavailable for this bill. Remove it and choose again.' using errcode='22023';
 end if;
 return item_id;
end $$;
revoke all on function private.bite_pos_catalog_item(uuid,uuid) from public,anon,authenticated;

-- Both the counter balance/visit flow and the property room/counter flow use
-- this writer. Keep validation, money math and snapshot behavior in that path.
do $patch$
declare
 definition text;
 old_line text:='insert into public.order_items(order_id,item_name,quantity,unit_price)
  values(v_order_id,btrim(v_item->>''name''),(v_item->>''quantity'')::numeric,(v_item->>''unit_price'')::numeric);';
 new_line text:='insert into public.order_items(order_id,item_name,quantity,unit_price,menu_item_id)
  values(v_order_id,btrim(v_item->>''name''),(v_item->>''quantity'')::numeric,(v_item->>''unit_price'')::numeric,
   private.bite_pos_catalog_item(p_restaurant_id,nullif(v_item->>''menu_item_id'','''')::uuid));';
begin
 definition:=pg_get_functiondef('private.create_order_with_items_and_table(uuid,text,text,text,text,jsonb,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,old_line,'')))/length(old_line)<>1 then
  raise exception 'POS order writer changed. Review the channel migration before applying.';
 end if;
 execute replace(definition,old_line,new_line);
end $patch$;
