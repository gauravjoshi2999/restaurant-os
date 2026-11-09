-- Owner may recover an expired or locked delivery link after physical handover.
-- Existing token hashes are invalidated; ownership, 32-byte tokens and expiry remain enforced.
CREATE OR REPLACE FUNCTION public.create_delivery_handoff(p_order_id uuid)
 RETURNS TABLE(token text, order_code text, customer_name text, customer_phone text, delivery_address jsonb, customer_note text, restaurant_name text, items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_token text;
  v_otp text;
begin
  if auth.uid() is null then raise exception 'Owner login required.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.has_restaurant_role(v_order.restaurant_id,array['owner']) then
    raise exception 'Only the restaurant owner can create a delivery handoff link.';
  end if;
  if v_order.status NOT IN ('Ready','Handed Over') or v_order.delivery_type <> 'delivery' or v_order.customer_id is null or v_order.delivery_address_snapshot is null then
    raise exception 'Delivery link is available only for a Ready or Handed Over delivery order with customer address.';
  end if;
  update public.restaurant_delivery_handoffs set is_active=false where order_id=p_order_id and is_active;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_otp := lpad((floor(random()*10000))::integer::text,4,'0');
  insert into public.restaurant_delivery_handoffs(order_id,restaurant_id,token_hash,delivery_otp,created_by)
    values(p_order_id,v_order.restaurant_id,extensions.digest(v_token,'sha256'),v_otp,auth.uid());
  return query
    select v_token,v_order.order_code,v_order.customer_name,v_order.customer_phone,
      v_order.delivery_address_snapshot,v_order.customer_note,r.name,
      coalesce((select jsonb_agg(jsonb_build_object('item_name',oi.item_name,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total) order by oi.created_at)
        from public.order_items oi where oi.order_id=p_order_id),'[]'::jsonb)
    from public.restaurants r where r.id=v_order.restaurant_id;
end;
$function$

