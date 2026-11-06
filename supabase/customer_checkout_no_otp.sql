-- Customer checkout contact details without SMS/phone OTP.
-- Apply AFTER customer_storefront_foundation.sql.
-- Email/password remains the account login. Contact phone is customer-entered and NOT verified.

begin;

create table if not exists public.customer_contact_profiles (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 80),
  phone text not null check (length(regexp_replace(phone, '[^0-9]', '', 'g')) between 10 and 15),
  updated_at timestamptz not null default now()
);

alter table public.customer_contact_profiles enable row level security;
drop policy if exists "customers manage own contact profile" on public.customer_contact_profiles;
create policy "customers manage own contact profile"
on public.customer_contact_profiles for all to authenticated
using (customer_id = (select auth.uid()))
with check (customer_id = (select auth.uid()));
grant select, insert, update, delete on public.customer_contact_profiles to authenticated;

create or replace function public.place_customer_order(
  p_restaurant_id uuid,
  p_delivery_type text,
  p_address_id uuid,
  p_customer_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_phone text;
  v_address jsonb := null;
  v_order_id uuid;
  v_item jsonb;
  v_menu_item public.menu_items%rowtype;
  v_qty numeric(10,2);
  v_total numeric(14,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_minimum numeric(12,2) := 0;
  v_accepts_delivery boolean;
  v_accepts_pickup boolean;
  v_order_code text;
begin
  if v_user is null then raise exception 'Customer login required.'; end if;
  if p_delivery_type not in ('delivery','pickup') then
    raise exception 'Choose delivery or pickup.';
  end if;

  select cp.full_name, cp.phone
    into v_name, v_phone
  from public.customer_contact_profiles cp
  where cp.customer_id = v_user;

  if v_name is null then
    raise exception 'Please save your name and mobile number before placing the order.';
  end if;
  if length(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g')) < 10 then
    raise exception 'Please enter a valid contact mobile number.';
  end if;

  select r.default_delivery_fee, r.minimum_order_amount,
         r.accepts_delivery, r.accepts_pickup
    into v_delivery_fee, v_minimum, v_accepts_delivery, v_accepts_pickup
  from public.restaurants r
  where r.id = p_restaurant_id and r.is_published and r.status = 'Active';
  if not found then raise exception 'This restaurant is not accepting online orders.'; end if;

  if p_delivery_type = 'delivery' and not v_accepts_delivery then
    raise exception 'This restaurant does not offer delivery.';
  end if;
  if p_delivery_type = 'pickup' and not v_accepts_pickup then
    raise exception 'This restaurant does not offer pickup.';
  end if;

  if p_delivery_type = 'delivery' then
    select jsonb_build_object(
      'label', a.label, 'recipient_name', a.recipient_name,
      'recipient_phone', a.recipient_phone, 'address_line', a.address_line,
      'landmark', a.landmark, 'city', a.city, 'state', a.state,
      'postal_code', a.postal_code
    ) into v_address
    from public.customer_addresses a
    where a.id = p_address_id and a.customer_id = v_user;
    if v_address is null then raise exception 'Select one of your saved delivery addresses.'; end if;
    v_address := v_address || jsonb_build_object('recipient_name',v_name,'recipient_phone',v_phone);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item->>'quantity') is null then raise exception 'Invalid item quantity.'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty <= 0 or v_qty > 99 then raise exception 'Item quantity is out of range.'; end if;

    select * into v_menu_item
    from public.menu_items mi
    where mi.id = (v_item->>'menu_item_id')::uuid
      and mi.restaurant_id = p_restaurant_id
      and mi.is_available;
    if not found then raise exception 'One or more menu items are no longer available.'; end if;

    v_total := v_total + round(v_qty * v_menu_item.price, 2);
  end loop;

  if v_total < v_minimum then
    raise exception 'Order is below this restaurant minimum order amount.'; end if;

  v_order_code := 'ROS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.orders (
    restaurant_id, order_code, channel, amount, status,
    customer_name, customer_phone, created_by, customer_id,
    delivery_type, delivery_address_snapshot, customer_note
  ) values (
    p_restaurant_id, v_order_code, 'Own Platform', v_total, 'Received',
    v_name, v_phone, v_user, v_user,
    p_delivery_type, v_address, nullif(btrim(p_customer_note),'')
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_menu_item
    from public.menu_items mi
    where mi.id = (v_item->>'menu_item_id')::uuid
      and mi.restaurant_id = p_restaurant_id
      and mi.is_available;

    insert into public.order_items(order_id,item_name,quantity,unit_price)
    values (v_order_id,v_menu_item.name,(v_item->>'quantity')::numeric,v_menu_item.price);
  end loop;

  insert into public.order_financials (
    order_id, restaurant_id, channel, food_subtotal,
    commissionable_food_value, commission_rate, commission_amount,
    delivery_fee, customer_payable_amount, payment_status, created_by
  ) values (
    v_order_id, p_restaurant_id, 'Own Platform', v_total,
    v_total, 18.00, round(v_total * 0.18,2),
    case when p_delivery_type = 'delivery' then v_delivery_fee else 0 end,
    v_total + case when p_delivery_type = 'delivery' then v_delivery_fee else 0 end,
    'pending', v_user
  );

  return v_order_id;
end;
$$;

revoke execute on function public.place_customer_order(uuid,text,uuid,text,jsonb) from public, anon;
grant execute on function public.place_customer_order(uuid,text,uuid,text,jsonb) to authenticated;

commit;

-- Verification: both objects should be present.
select table_name from information_schema.tables
where table_schema='public' and table_name='customer_contact_profiles';

select routine_name from information_schema.routines
where routine_schema='public' and routine_name='place_customer_order';
