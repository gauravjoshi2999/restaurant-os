-- RestaurantOS: financial snapshots and settlement foundation.
-- This migration creates records only. It does not collect payments or transfer money.
-- Apply only after schema.sql, phase2_roles.sql, order_lifecycle.sql,
-- and order_details_multi_items.sql have already been applied.

begin;

create table if not exists public.order_financials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  channel text not null,
  currency text not null default 'INR' check (currency = 'INR'),
  food_subtotal numeric(14,2) not null check (food_subtotal >= 0),
  restaurant_discount numeric(14,2) not null default 0 check (restaurant_discount >= 0),
  platform_discount numeric(14,2) not null default 0 check (platform_discount >= 0),
  commissionable_food_value numeric(14,2) not null check (commissionable_food_value >= 0),
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  tip_amount numeric(14,2) not null default 0 check (tip_amount >= 0),
  customer_payable_amount numeric(14,2) not null check (customer_payable_amount >= 0),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','paid','partially_refunded','refunded','failed')),
  provider_fee_actual numeric(14,2) check (provider_fee_actual is null or provider_fee_actual >= 0),
  refund_amount_actual numeric(14,2) not null default 0 check (refund_amount_actual >= 0),
  settlement_status text not null default 'not_ready'
    check (settlement_status in ('not_ready','unsettled','included','partially_settled','settled','on_hold')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint order_financials_discount_within_subtotal
    check (restaurant_discount + platform_discount <= food_subtotal),
  constraint order_financials_commission_within_base
    check (commission_amount <= commissionable_food_value)
);

create index if not exists order_financials_restaurant_created_idx
  on public.order_financials (restaurant_id, created_at desc);

alter table public.order_financials enable row level security;

drop policy if exists "restaurant members and platform admins read order financials"
  on public.order_financials;
create policy "restaurant members and platform admins read order financials"
on public.order_financials for select to authenticated
using (
  public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
);

revoke all on public.order_financials from anon, authenticated;
grant select on public.order_financials to authenticated;

-- Snapshot the financial terms once per order. Values are computed on the server;
-- the browser cannot submit or choose the commission rate or commission amount.
create or replace function public.create_order_financial_snapshot(
  p_order_id uuid,
  p_restaurant_discount numeric default 0,
  p_platform_discount numeric default 0,
  p_tax_amount numeric default 0,
  p_delivery_fee numeric default 0,
  p_tip_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_subtotal numeric(14,2);
  v_commission_base numeric(14,2);
  v_rate numeric(5,2);
  v_commission numeric(14,2);
  v_customer_payable numeric(14,2);
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Login required.';
  end if;

  if coalesce(p_restaurant_discount,0) < 0
     or coalesce(p_platform_discount,0) < 0
     or coalesce(p_tax_amount,0) < 0
     or coalesce(p_delivery_fee,0) < 0
     or coalesce(p_tip_amount,0) < 0 then
    raise exception 'Discounts, tax, delivery and tip cannot be negative.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Order not found.';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_restaurant_role(v_order.restaurant_id, array['owner','manager'])
  ) then
    raise exception 'Only the restaurant owner, manager or platform admin can create a financial snapshot.';
  end if;

  if exists (select 1 from public.order_financials where order_id = p_order_id) then
    raise exception 'A financial snapshot already exists for this order. Historical snapshots cannot be overwritten.';
  end if;

  select coalesce(sum(oi.line_total),0)::numeric(14,2)
    into v_subtotal
  from public.order_items oi
  where oi.order_id = p_order_id;

  if v_subtotal <> round(v_order.amount,2) then
    raise exception 'Order total does not match its item subtotal. Resolve the order items before recording financials.';
  end if;

  if coalesce(p_restaurant_discount,0) + coalesce(p_platform_discount,0) > v_subtotal then
    raise exception 'Combined discounts cannot exceed the food subtotal.';
  end if;

  v_commission_base := round(v_subtotal - coalesce(p_restaurant_discount,0),2);

  if v_order.channel = 'Own Platform' then
    v_rate := 18.00;
  elsif v_order.channel in ('Zomato (demo)','Swiggy (demo)') then
    v_rate := 0.00;
  else
    raise exception 'Unknown order channel. No financial snapshot was created.';
  end if;

  v_commission := round(v_commission_base * v_rate / 100,2);
  v_customer_payable := round(
    v_subtotal - coalesce(p_restaurant_discount,0)
      - coalesce(p_platform_discount,0)
      + coalesce(p_tax_amount,0)
      + coalesce(p_delivery_fee,0)
      + coalesce(p_tip_amount,0), 2
  );

  insert into public.order_financials (
    order_id, restaurant_id, channel,
    food_subtotal, restaurant_discount, platform_discount,
    commissionable_food_value, commission_rate, commission_amount,
    tax_amount, delivery_fee, tip_amount, customer_payable_amount,
    created_by
  ) values (
    v_order.id, v_order.restaurant_id, v_order.channel,
    v_subtotal, coalesce(p_restaurant_discount,0), coalesce(p_platform_discount,0),
    v_commission_base, v_rate, v_commission,
    coalesce(p_tax_amount,0), coalesce(p_delivery_fee,0), coalesce(p_tip_amount,0),
    v_customer_payable, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_order_financial_snapshot(uuid,numeric,numeric,numeric,numeric,numeric)
  from public, anon;
grant execute on function public.create_order_financial_snapshot(uuid,numeric,numeric,numeric,numeric,numeric)
  to authenticated;

create table if not exists public.restaurant_settlements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  currency text not null default 'INR' check (currency = 'INR'),
  gross_order_value numeric(14,2) not null default 0 check (gross_order_value >= 0),
  commission_total numeric(14,2) not null default 0 check (commission_total >= 0),
  provider_fees_actual numeric(14,2) not null default 0 check (provider_fees_actual >= 0),
  refunds_actual numeric(14,2) not null default 0 check (refunds_actual >= 0),
  other_adjustments numeric(14,2) not null default 0,
  net_payable numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  provider_reference text,
  status text not null default 'draft'
    check (status in ('draft','pending','processing','paid','failed','on_hold')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  check (period_end >= period_start),
  check (amount_paid <= greatest(net_payable,0))
);

create index if not exists restaurant_settlements_restaurant_period_idx
  on public.restaurant_settlements (restaurant_id, period_start desc);

alter table public.restaurant_settlements enable row level security;
drop policy if exists "restaurant members and platform admins read settlements"
  on public.restaurant_settlements;
create policy "restaurant members and platform admins read settlements"
on public.restaurant_settlements for select to authenticated
using (
  public.is_platform_admin()
  or public.is_restaurant_member(restaurant_id)
);
revoke all on public.restaurant_settlements from anon, authenticated;
grant select on public.restaurant_settlements to authenticated;

create table if not exists public.restaurant_settlement_items (
  settlement_id uuid not null references public.restaurant_settlements(id) on delete restrict,
  order_financial_id uuid not null references public.order_financials(id) on delete restrict,
  order_amount numeric(14,2) not null check (order_amount >= 0),
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  refund_amount numeric(14,2) not null default 0 check (refund_amount >= 0),
  primary key (settlement_id, order_financial_id),
  unique (order_financial_id)
);

alter table public.restaurant_settlement_items enable row level security;
drop policy if exists "restaurant members and platform admins read settlement items"
  on public.restaurant_settlement_items;
create policy "restaurant members and platform admins read settlement items"
on public.restaurant_settlement_items for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.restaurant_settlements rs
    where rs.id = restaurant_settlement_items.settlement_id
      and public.is_restaurant_member(rs.restaurant_id)
  )
);
revoke all on public.restaurant_settlement_items from anon, authenticated;
grant select on public.restaurant_settlement_items to authenticated;

create table if not exists public.platform_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null check (category in (
    'hosting','software','staff','marketing','support','legal_accounting','other'
  )),
  description text not null check (length(btrim(description)) > 0),
  amount numeric(14,2) not null check (amount > 0),
  vendor text,
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.platform_expenses enable row level security;
drop policy if exists "platform admins manage platform expenses" on public.platform_expenses;
create policy "platform admins manage platform expenses"
on public.platform_expenses for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
revoke all on public.platform_expenses from anon, authenticated;
grant select, insert, update, delete on public.platform_expenses to authenticated;

commit;

-- Verification: each query should return the named object(s).
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'order_financials','restaurant_settlements',
    'restaurant_settlement_items','platform_expenses'
  )
order by table_name;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'create_order_financial_snapshot';
