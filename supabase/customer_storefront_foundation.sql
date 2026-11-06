-- RestaurantOS Customer Website foundation: customer accounts, public menus and live order tracking.
-- Apply AFTER automatic_order_financial_snapshots.sql has been run successfully.
-- Customer login uses Supabase Phone OTP; configure an SMS provider in Supabase Auth first.
-- This migration does not enable real payment collection or a rider fleet.

begin;

-- Public storefront controls and restaurant delivery settings.
alter table public.restaurants
  add column if not exists is_published boolean not null default false,
  add column if not exists public_description text,
  add column if not exists cuisine_tags text[] not null default '{}',
  add column if not exists default_delivery_fee numeric(12,2) not null default 0
    check (default_delivery_fee >= 0),
  add column if not exists minimum_order_amount numeric(12,2) not null default 0
    check (minimum_order_amount >= 0),
  add column if not exists accepts_delivery boolean not null default true,
  add column if not exists accepts_pickup boolean not null default true,
  add column if not exists estimated_prep_minutes integer not null default 30
    check (estimated_prep_minutes between 5 and 240);

-- Customer identity is the authenticated Supabase user. The existing profiles row
-- is created by the auth.users trigger in schema.sql.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  recipient_name text not null,
  recipient_phone text not null,
  address_line text not null,
  landmark text,
  city text not null,
  state text not null default 'Rajasthan',
  postal_code text,
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null and longitude is null) or
         (latitude between -90 and 90 and longitude between -180 and 180))
);
create index if not exists customer_addresses_owner_idx
  on public.customer_addresses(customer_id, is_default desc, created_at desc);
alter table public.customer_addresses enable row level security;
drop policy if exists "customers manage own addresses" on public.customer_addresses;
create policy "customers manage own addresses"
on public.customer_addresses for all to authenticated
using (customer_id = (select auth.uid()))
with check (customer_id = (select auth.uid()));
grant select, insert, update, delete on public.customer_addresses to authenticated;

-- Restaurant menu catalog. Prices are always re-read from this table by the order RPC.
create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name)
);
create index if not exists menu_categories_restaurant_idx
  on public.menu_categories(restaurant_id, sort_order);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  description text,
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  is_vegetarian boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menu_items_restaurant_idx
  on public.menu_items(restaurant_id, is_available, sort_order);

alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;

drop policy if exists "public can read published menu categories" on public.menu_categories;
create policy "public can read published menu categories"
on public.menu_categories for select to anon, authenticated
using (
  is_active and exists (
    select 1 from public.restaurants r
    where r.id = menu_categories.restaurant_id and r.is_published
  )
  or public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
);

drop policy if exists "restaurant teams manage menu categories" on public.menu_categories;
create policy "restaurant teams manage menu categories"
on public.menu_categories for all to authenticated
using (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager'])
)
with check (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager'])
);

drop policy if exists "public can read available items from published menus" on public.menu_items;
create policy "public can read available items from published menus"
on public.menu_items for select to anon, authenticated
using (
  is_available and exists (
    select 1 from public.restaurants r
    where r.id = menu_items.restaurant_id and r.is_published
  )
  or public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
);

drop policy if exists "restaurant teams manage menu items" on public.menu_items;
create policy "restaurant teams manage menu items"
on public.menu_items for all to authenticated
using (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager'])
)
with check (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager'])
);

grant select on public.menu_categories, public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_categories, public.menu_items to authenticated;

-- Return only safe public-facing restaurant fields; never expose private onboarding notes/contact data.
create or replace function public.list_public_restaurants()
returns table (
  id uuid, name text, city text, address text, public_description text,
  cuisine_tags text[], default_delivery_fee numeric, minimum_order_amount numeric,
  accepts_delivery boolean, accepts_pickup boolean, estimated_prep_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.city, r.address, r.public_description, r.cuisine_tags,
         r.default_delivery_fee, r.minimum_order_amount, r.accepts_delivery,
         r.accepts_pickup, r.estimated_prep_minutes
  from public.restaurants r
  where r.is_published and r.status = 'Active'
  order by r.name;
$$;
revoke execute on function public.list_public_restaurants() from public;
grant execute on function public.list_public_restaurants() to anon, authenticated;

-- Attach customer ownership and delivery information to orders.
alter table public.orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null,
  add column if not exists delivery_type text not null default 'delivery'
    check (delivery_type in ('delivery','pickup')),
  add column if not exists delivery_address_snapshot jsonb,
  add column if not exists customer_note text;

create index if not exists orders_customer_date_idx
  on public.orders(customer_id, order_date desc);

drop policy if exists "customers can read own orders" on public.orders;
create policy "customers can read own orders"
on public.orders for select to authenticated
using (customer_id = (select auth.uid()));

-- Customers may see only their own status timeline.
drop policy if exists "customers can read own order status history" on public.order_status_history;
create policy "customers can read own order status history"
on public.order_status_history for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and o.customer_id = (select auth.uid())
  )
);
grant select on public.orders, public.order_status_history to authenticated;

-- Optional live delivery-person location. It appears only when a restaurant
-- explicitly shares location; status tracking works without GPS.
create table if not exists public.order_delivery_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(10,2),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.order_delivery_locations enable row level security;

drop policy if exists "customers and restaurant teams read delivery location" on public.order_delivery_locations;
create policy "customers and restaurant teams read delivery location"
on public.order_delivery_locations for select to authenticated
using (
  public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
  or exists (
    select 1 from public.orders o
    where o.id = order_delivery_locations.order_id
      and o.customer_id = (select auth.uid())
  )
);

drop policy if exists "restaurant teams update delivery location" on public.order_delivery_locations;
create policy "restaurant teams update delivery location"
on public.order_delivery_locations for all to authenticated
using (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager','staff'])
)
with check (
  public.is_platform_admin()
  or public.has_restaurant_role(restaurant_id, array['owner','manager','staff'])
);
grant select, insert, update, delete on public.order_delivery_locations to authenticated;

-- Realtime requires the tables to be in Supabase's realtime publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'order_status_history'
    ) then
      alter publication supabase_realtime add table public.order_status_history;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'order_delivery_locations'
    ) then
      alter publication supabase_realtime add table public.order_delivery_locations;
    end if;
  end if;
end;
$$;

-- Place an order from the customer storefront. Server verifies menu prices,
-- creates order/items and financial snapshot atomically. Payment is NOT collected here.
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

  select coalesce(nullif(btrim(p.full_name),''), nullif(btrim(u.raw_user_meta_data->>'full_name'),'')),
         u.phone
    into v_name, v_phone
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_user;

  if v_phone is null or length(regexp_replace(v_phone, '\\D', '', 'g')) < 10 then
    raise exception 'A verified mobile number is required on your account.';
  end if;
  if v_name is null then raise exception 'Please add your name to your profile first.'; end if;

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
    raise exception 'Order is below this restaurant minimum order amount.';
  end if;

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

-- Verification: each query should return the listed objects/policies.
select table_name from information_schema.tables
where table_schema='public'
and table_name in ('customer_addresses','menu_categories','menu_items','order_delivery_locations')
order by table_name;

select column_name from information_schema.columns
where table_schema='public' and table_name='orders'
and column_name in ('customer_id','delivery_type','delivery_address_snapshot','customer_note')
order by column_name;

select routine_name from information_schema.routines
where routine_schema='public'
and routine_name in ('list_public_restaurants','place_customer_order')
order by routine_name;
