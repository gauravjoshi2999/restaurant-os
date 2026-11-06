-- RestaurantOS: customer order history and safe item visibility.
-- Run once in Supabase SQL Editor. Safe to re-run.

begin;

-- Customers may read only the line items belonging to their own orders.
drop policy if exists "customers can read own order items" on public.order_items;
create policy "customers can read own order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.customer_id = (select auth.uid())
  )
);

-- Return the signed-in customer's order history with restaurant names.
-- SECURITY DEFINER is limited to the caller's own customer_id.
create or replace function public.list_my_customer_orders()
returns table (
  id uuid,
  order_code text,
  restaurant_id uuid,
  restaurant_name text,
  amount numeric,
  status text,
  order_date timestamptz,
  customer_name text,
  delivery_type text,
  customer_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.order_code,
    o.restaurant_id,
    r.name as restaurant_name,
    o.amount,
    o.status,
    o.order_date,
    o.customer_name,
    o.delivery_type,
    o.customer_note
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where auth.uid() is not null
    and o.customer_id = (select auth.uid())
  order by o.order_date desc, o.created_at desc;
$$;

revoke execute on function public.list_my_customer_orders() from public, anon;
grant execute on function public.list_my_customer_orders() to authenticated;

commit;

-- Verification: both the customer item policy and history RPC should exist.
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'order_items'
  and policyname = 'customers can read own order items';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'list_my_customer_orders';
