-- RestaurantOS: customer details and multi-item orders.
-- Run once in Supabase SQL Editor. Safe to re-run.

begin;

alter table public.orders
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_name text not null check (length(btrim(item_name)) > 0),
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx
  on public.order_items (order_id);

alter table public.order_items enable row level security;

drop policy if exists "members and platform admins can read order items"
  on public.order_items;
create policy "members and platform admins can read order items"
on public.order_items
for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.is_restaurant_member(o.restaurant_id)
  )
);

grant select on public.order_items to authenticated;

create or replace function public.create_order_with_items(
  p_restaurant_id uuid,
  p_order_code text,
  p_channel text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_name text;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_total numeric(14,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Login required.';
  end if;

  if not (
    public.is_platform_admin()
    or public.is_restaurant_member(p_restaurant_id)
  ) then
    raise exception 'You do not have access to this restaurant.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one order item.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_name := nullif(btrim(v_item->>'name'), '');
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;

    if v_name is null then
      raise exception 'Every item needs a name.';
    end if;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Item quantity must be greater than zero.';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Item price cannot be negative.';
    end if;

    v_total := v_total + round(v_quantity * v_unit_price, 2);
  end loop;

  insert into public.orders (
    restaurant_id, order_code, channel, amount, status,
    customer_name, customer_phone, created_by
  )
  values (
    p_restaurant_id, p_order_code, p_channel, v_total, 'Received',
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    auth.uid()
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, item_name, quantity, unit_price
    )
    values (
      v_order_id,
      btrim(v_item->>'name'),
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric
    );
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function public.create_order_with_items(uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.create_order_with_items(uuid, text, text, text, text, jsonb)
  to authenticated;

commit;

-- Verification
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('customer_name', 'customer_phone')
order by column_name;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'order_items';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'create_order_with_items';
