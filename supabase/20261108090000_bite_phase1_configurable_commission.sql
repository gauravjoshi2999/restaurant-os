-- Bite Phase 1: configurable marketplace commission (10% default).
-- Additive only. Existing order financial snapshots are immutable and unchanged.

create table if not exists public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  default_commission_rate numeric(5,2) not null default 10.00
    check (default_commission_rate >= 0 and default_commission_rate <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.platform_settings (id, default_commission_rate)
values (1, 10.00)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select, update on public.platform_settings to authenticated;

drop policy if exists "Platform admins read platform settings" on public.platform_settings;
create policy "Platform admins read platform settings"
  on public.platform_settings for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "Platform admins update platform settings" on public.platform_settings;
create policy "Platform admins update platform settings"
  on public.platform_settings for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.restaurants
  add column if not exists platform_commission_rate numeric(5,2)
  check (platform_commission_rate is null or (platform_commission_rate >= 0 and platform_commission_rate <= 100));

create or replace function public.guard_restaurant_commission_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform_commission_rate is distinct from old.platform_commission_rate
     and not public.is_platform_admin() then
    raise exception 'Only Bite platform administrators can change restaurant commission.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_restaurant_commission_rate() from public, anon, authenticated;
drop trigger if exists restaurants_guard_commission_rate on public.restaurants;
create trigger restaurants_guard_commission_rate
before update on public.restaurants
for each row execute function public.guard_restaurant_commission_rate();

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
 v_can_adjust boolean;
begin
 if auth.uid() is null then raise exception 'Login required.'; end if;
 if coalesce(p_restaurant_discount,0)<0 or coalesce(p_platform_discount,0)<0
  or coalesce(p_tax_amount,0)<0 or coalesce(p_delivery_fee,0)<0 or coalesce(p_tip_amount,0)<0 then
  raise exception 'Discounts, tax, delivery and tip cannot be negative.';
 end if;
 select * into v_order from public.orders where id=p_order_id;
 if not found then raise exception 'Order not found.'; end if;
 v_can_adjust:=public.is_platform_admin() or public.has_restaurant_role(v_order.restaurant_id,array['owner','manager']);
 if not (v_can_adjust or public.is_restaurant_member(v_order.restaurant_id)) then
  raise exception 'You do not have access to this restaurant.';
 end if;
 if not v_can_adjust and (
  coalesce(p_restaurant_discount,0)<>0 or coalesce(p_platform_discount,0)<>0
  or coalesce(p_tax_amount,0)<>0 or coalesce(p_delivery_fee,0)<>0 or coalesce(p_tip_amount,0)<>0
 ) then
  raise exception 'Staff can create only a zero-adjustment financial snapshot. Ask an owner or manager to record adjustments.';
 end if;
 if exists(select 1 from public.order_financials where order_id=p_order_id) then
  raise exception 'A financial snapshot already exists for this order. Historical snapshots cannot be overwritten.';
 end if;
 select coalesce(sum(oi.line_total),0)::numeric(14,2) into v_subtotal
 from public.order_items oi where oi.order_id=p_order_id;
 if v_subtotal<>round(v_order.amount,2) then
  raise exception 'Order total does not match its item subtotal. Resolve the order items before recording financials.';
 end if;
 if coalesce(p_restaurant_discount,0)+coalesce(p_platform_discount,0)>v_subtotal then
  raise exception 'Combined discounts cannot exceed the food subtotal.';
 end if;
 if v_order.channel='Own Platform' then
  select coalesce(r.platform_commission_rate, ps.default_commission_rate, 10.00)
    into v_rate
  from public.restaurants r
  left join public.platform_settings ps on ps.id=1
  where r.id=v_order.restaurant_id;
  if v_rate is null then v_rate:=10.00; end if;
 elsif v_order.channel in ('Zomato (demo)','Swiggy (demo)','POS - Counter','POS - Takeaway','POS - Dine-in') then
  v_rate:=0.00;
 else
  raise exception 'Unknown order channel. No financial snapshot was created.';
 end if;
 v_commission_base:=round(v_subtotal-coalesce(p_restaurant_discount,0),2);
 v_commission:=round(v_commission_base*v_rate/100,2);
 v_customer_payable:=round(
  v_subtotal-coalesce(p_restaurant_discount,0)-coalesce(p_platform_discount,0)
  +coalesce(p_tax_amount,0)+coalesce(p_delivery_fee,0)+coalesce(p_tip_amount,0),2
 );
 insert into public.order_financials(
  order_id,restaurant_id,channel,food_subtotal,restaurant_discount,platform_discount,
  commissionable_food_value,commission_rate,commission_amount,tax_amount,delivery_fee,
  tip_amount,customer_payable_amount,created_by
 ) values(
  v_order.id,v_order.restaurant_id,v_order.channel,v_subtotal,
  coalesce(p_restaurant_discount,0),coalesce(p_platform_discount,0),
  v_commission_base,v_rate,v_commission,coalesce(p_tax_amount,0),
  coalesce(p_delivery_fee,0),coalesce(p_tip_amount,0),v_customer_payable,auth.uid()
 ) returning id into v_id;
 return v_id;
end;
$$;

revoke all on function public.create_order_financial_snapshot(uuid,numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.create_order_financial_snapshot(uuid,numeric,numeric,numeric,numeric,numeric) to authenticated, service_role;
