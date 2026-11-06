-- RestaurantOS weekly settlement draft generator.
-- Manual/admin-triggered only. No bank transfer or payment-provider API is called.
-- Run after financial_settlement_foundation.sql.

begin;

alter table public.restaurant_settlement_items
  add column if not exists provider_fee_actual numeric(14,2) not null default 0
  check (provider_fee_actual >= 0);

create unique index if not exists restaurant_settlements_one_period_per_restaurant
  on public.restaurant_settlements (restaurant_id, period_start, period_end);

-- Admin records the actual provider-confirmed payment fee and refund figures.
-- This is a manual ledger entry, not a payment-provider integration.
create or replace function public.record_order_payment_reconciliation(
  p_order_id uuid,
  p_provider_fee_actual numeric,
  p_refund_amount_actual numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_payable numeric(14,2);
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a signed-in RestaurantOS Super Admin can record payment reconciliation.';
  end if;

  if p_provider_fee_actual is null or p_provider_fee_actual < 0
     or coalesce(p_refund_amount_actual,0) < 0 then
    raise exception 'Enter non-negative actual gateway fee and refund amounts.';
  end if;

  select customer_payable_amount into v_customer_payable
  from public.order_financials
  where order_id = p_order_id
  for update;

  if not found then
    raise exception 'Create the order financial snapshot before recording payment reconciliation.';
  end if;

  if coalesce(p_refund_amount_actual,0) > v_customer_payable then
    raise exception 'Refund amount cannot exceed the recorded customer payable amount.';
  end if;

  update public.order_financials
  set payment_status = 'paid',
      provider_fee_actual = round(p_provider_fee_actual,2),
      refund_amount_actual = round(coalesce(p_refund_amount_actual,0),2)
  where order_id = p_order_id
    and settlement_status in ('not_ready','unsettled');

  if not found then
    raise exception 'Order was already included in a settlement or could not be updated.';
  end if;
end;
$$;

revoke execute on function public.record_order_payment_reconciliation(uuid,numeric,numeric)
  from public, anon;
grant execute on function public.record_order_payment_reconciliation(uuid,numeric,numeric)
  to authenticated;

create or replace function public.create_weekly_settlement_draft(
  p_restaurant_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settlement_id uuid;
  v_gross numeric(14,2);
  v_commission numeric(14,2);
  v_gateway numeric(14,2);
  v_refunds numeric(14,2);
  v_net numeric(14,2);
  v_count integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a signed-in RestaurantOS Super Admin can prepare settlement drafts.';
  end if;

  if p_restaurant_id is null or p_period_start is null or p_period_end is null then
    raise exception 'Restaurant and settlement dates are required.';
  end if;

  if p_period_end <> p_period_start + 6 then
    raise exception 'A weekly settlement period must contain exactly 7 calendar days (start date through end date).';
  end if;

  if p_period_end >= current_date then
    raise exception 'Only a fully completed past settlement week can be drafted.';
  end if;

  if exists (
    select 1 from public.restaurant_settlements rs
    where rs.restaurant_id = p_restaurant_id
      and rs.period_start = p_period_start
      and rs.period_end = p_period_end
  ) then
    raise exception 'A settlement draft already exists for this restaurant and week.';
  end if;

  if exists (
    select 1
    from public.order_financials f
    join public.orders o on o.id = f.order_id
    where f.restaurant_id = p_restaurant_id
      and f.channel = 'Own Platform'
      and o.status = 'Completed'
      and f.payment_status = 'paid'
      and o.order_date::date between p_period_start and p_period_end
      and f.provider_fee_actual is null
  ) then
    raise exception 'At least one eligible order is missing its actual payment gateway fee. Record the real fee before preparing settlement.';
  end if;

  select
    count(*),
    coalesce(sum(f.food_subtotal - f.restaurant_discount),0),
    coalesce(sum(f.commission_amount),0),
    coalesce(sum(f.provider_fee_actual),0),
    coalesce(sum(f.refund_amount_actual),0)
  into v_count, v_gross, v_commission, v_gateway, v_refunds
  from public.order_financials f
  join public.orders o on o.id = f.order_id
  where f.restaurant_id = p_restaurant_id
    and f.channel = 'Own Platform'
    and o.status = 'Completed'
    and f.payment_status = 'paid'
    and o.order_date::date between p_period_start and p_period_end
    and f.settlement_status in ('not_ready','unsettled');

  if v_count = 0 then
    raise exception 'No eligible paid and completed Own Platform orders are available for this week.';
  end if;

  v_net := round(v_gross - v_commission - v_gateway - v_refunds,2);

  if v_net < 0 then
    raise exception 'Calculated restaurant payable is negative. Review discounts, fees and refunds before settlement.';
  end if;

  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end,
    gross_order_value, commission_total, provider_fees_actual,
    refunds_actual, net_payable, status, created_by
  ) values (
    p_restaurant_id, p_period_start, p_period_end,
    v_gross, v_commission, v_gateway,
    v_refunds, v_net, 'draft', auth.uid()
  )
  returning id into v_settlement_id;

  insert into public.restaurant_settlement_items (
    settlement_id, order_financial_id, order_amount,
    commission_amount, provider_fee_actual, refund_amount
  )
  select
    v_settlement_id,
    f.id,
    round(f.food_subtotal - f.restaurant_discount,2),
    f.commission_amount,
    f.provider_fee_actual,
    f.refund_amount_actual
  from public.order_financials f
  join public.orders o on o.id = f.order_id
  where f.restaurant_id = p_restaurant_id
    and f.channel = 'Own Platform'
    and o.status = 'Completed'
    and f.payment_status = 'paid'
    and o.order_date::date between p_period_start and p_period_end
    and f.settlement_status in ('not_ready','unsettled');

  update public.order_financials f
  set settlement_status = 'included'
  from public.restaurant_settlement_items si
  where si.settlement_id = v_settlement_id
    and si.order_financial_id = f.id;

  return v_settlement_id;
end;
$$;

revoke execute on function public.create_weekly_settlement_draft(uuid,date,date)
  from public, anon;
grant execute on function public.create_weekly_settlement_draft(uuid,date,date)
  to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('record_order_payment_reconciliation','create_weekly_settlement_draft')
order by routine_name;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'restaurant_settlements_one_period_per_restaurant';
