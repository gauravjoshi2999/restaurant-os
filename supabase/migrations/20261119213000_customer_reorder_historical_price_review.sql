-- Bite Customer ORD-08: show verified historical unit prices alongside today's menu prices.
-- Additive change to the existing authenticated, customer-owned reorder RPC.
-- No order, payment, settlement or refund changes.
begin;
create or replace function public.bite_reorder_items(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  o public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login required' using errcode='42501';
  end if;
  select * into o
  from public.orders
  where id=p_order_id and customer_id=auth.uid();
  if not found then
    raise exception 'Order not found' using errcode='42501';
  end if;
  if not public.is_restaurant_public(o.restaurant_id) then
    raise exception 'Restaurant is currently unavailable';
  end if;
  return jsonb_build_object(
    'restaurant_id',o.restaurant_id,
    'items',(
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name',i.item_name,
            'quantity',i.quantity,
            'menu_item_id',m.id,
            'previous_price',i.unit_price,
            'price',m.price,
            'available',coalesce(m.is_available,false)
          )
          order by i.created_at
        ),
        '[]'::jsonb
      )
      from public.order_items i
      left join lateral (
        select mi.id,mi.price,mi.is_available
        from public.menu_items mi
        where mi.restaurant_id=o.restaurant_id
          and (
            mi.id=i.menu_item_id
            or (
              i.menu_item_id is null
              and mi.name=i.item_name
              and (
                select count(*)
                from public.menu_items x
                where x.restaurant_id=o.restaurant_id and x.name=i.item_name
              )=1
            )
          )
        limit 1
      ) m on true
      where i.order_id=o.id
    )
  );
end
$$;
revoke all on function public.bite_reorder_items(uuid) from public,anon;
grant execute on function public.bite_reorder_items(uuid) to authenticated;
commit;
