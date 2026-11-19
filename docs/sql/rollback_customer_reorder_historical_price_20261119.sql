-- Original Bite Reorder RPC snapshot, for authorized manual rollback only.
-- Captured from production before historical-price contract update.
-- Does not change order/payment records. Keeps anonymous EXECUTE revoked.
begin;
CREATE OR REPLACE FUNCTION public.bite_reorder_items(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype;
begin
 select * into o from public.orders where id=p_order_id and customer_id=auth.uid();
 if not found then raise exception 'Order not found';end if;
 if not public.is_restaurant_public(o.restaurant_id) then raise exception 'Restaurant is currently unavailable';end if;
 return jsonb_build_object('restaurant_id',o.restaurant_id,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.item_name,'quantity',i.quantity,'menu_item_id',m.id,'price',m.price,'available',coalesce(m.is_available,false))),'[]'::jsonb) from public.order_items i left join lateral(select mi.id,mi.price,mi.is_available from public.menu_items mi where mi.restaurant_id=o.restaurant_id and (mi.id=i.menu_item_id or (i.menu_item_id is null and mi.name=i.item_name and (select count(*) from public.menu_items x where x.restaurant_id=o.restaurant_id and x.name=i.item_name)=1)) limit 1)m on true where i.order_id=o.id));
end $function$;
revoke all on function public.bite_reorder_items(uuid) from public,anon;
grant execute on function public.bite_reorder_items(uuid) to authenticated,service_role;
commit;
