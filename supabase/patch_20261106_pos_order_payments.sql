-- POS order payments, split/partial receipts, and Cashbook integration.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- Reference patch; live Supabase schema is authoritative.

create table if not exists public.restaurant_order_payments (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 amount numeric(14,2) not null check(amount>0),
 payment_method text not null check(payment_method in ('Cash','UPI','Card','Bank Transfer','Other')),
 payment_date date not null default current_date,
 reference text,notes text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists restaurant_order_payments_order_idx on public.restaurant_order_payments(order_id,payment_date);
create index if not exists restaurant_order_payments_rest_date_idx on public.restaurant_order_payments(restaurant_id,payment_date desc);
create index if not exists restaurant_order_payments_created_by_idx on public.restaurant_order_payments(created_by);
alter table public.restaurant_order_payments enable row level security;
drop policy if exists "Order payments members read" on public.restaurant_order_payments;
create policy "Order payments members read" on public.restaurant_order_payments for select to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) or public.is_platform_admin());
drop policy if exists "Order payments members insert" on public.restaurant_order_payments;
create policy "Order payments members insert" on public.restaurant_order_payments for insert to authenticated
with check(
 public.has_restaurant_role(restaurant_id,array['owner','manager','staff'])
 and created_by=(select auth.uid())
 and exists(select 1 from public.orders o where o.id=restaurant_order_payments.order_id and o.restaurant_id=restaurant_order_payments.restaurant_id)
);

create or replace function public.guard_restaurant_order_payment()
returns trigger language plpgsql set search_path='' as $$
declare order_total numeric(14,2);order_channel text;paid_total numeric(14,2);
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner','manager','staff']) then raise exception 'Restaurant team access required to record payment'; end if;
 perform 1 from public.orders o where o.id=new.order_id and o.restaurant_id=new.restaurant_id for update;
 if not found then raise exception 'Order must belong to the same restaurant'; end if;
 select o.amount,o.channel into order_total,order_channel from public.orders o where o.id=new.order_id;
 if order_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then
  raise exception 'Manual payment entry is only for POS orders; online platform payments are provider managed';
 end if;
 select coalesce(sum(p.amount),0) into paid_total from public.restaurant_order_payments p where p.order_id=new.order_id;
 if paid_total+new.amount>order_total then raise exception 'Payment exceeds order balance'; end if;
 if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.payment_date) then
  raise exception 'This cashbook day is already closed';
 end if;
 return new;
end;
$$;
drop trigger if exists restaurant_order_payments_guard on public.restaurant_order_payments;
create trigger restaurant_order_payments_guard before insert on public.restaurant_order_payments
for each row execute function public.guard_restaurant_order_payment();

create or replace view public.restaurant_order_payment_summaries with (security_invoker=true) as
select o.id as order_id,o.restaurant_id,o.amount as order_total,
 coalesce(sum(p.amount),0)::numeric(14,2) as paid_amount,
 greatest(o.amount-coalesce(sum(p.amount),0),0)::numeric(14,2) as balance_amount,
 case when coalesce(sum(p.amount),0)>=o.amount and o.amount>0 then 'paid'
      when coalesce(sum(p.amount),0)>0 then 'partial' else 'unpaid' end as payment_status
from public.orders o
left join public.restaurant_order_payments p on p.order_id=o.id and p.restaurant_id=o.restaurant_id
group by o.id,o.restaurant_id,o.amount;
grant select on public.restaurant_order_payment_summaries to authenticated;
grant select,insert on public.restaurant_order_payments to authenticated;

create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as
select e.id as entry_id,e.restaurant_id,e.expense_date as entry_date,'out'::text as direction,
 e.category,e.amount,e.payment_method,e.title as description,'expense'::text as source_type,e.id as source_id,e.created_at
from public.restaurant_expenses e
union all
select p.id,p.restaurant_id,p.purchase_date,'out'::text,'Purchase payment'::text,p.paid_amount,p.payment_method,
 coalesce(s.name,p.supplier_name_snapshot,'Purchase payment')::text,'purchase'::text,p.id,p.created_at
from public.restaurant_purchases p left join public.restaurant_suppliers s on s.id=p.supplier_id where p.paid_amount>0
union all
select m.id,m.restaurant_id,m.entry_date,m.direction,m.category,m.amount,m.payment_method,
 coalesce(m.description,m.category),'manual'::text,m.id,m.created_at
from public.restaurant_cashbook_manual_entries m
union all
select p.id,p.restaurant_id,p.payment_date,'in'::text,'Order payment'::text,p.amount,p.payment_method,
 coalesce(o.order_code,'Order')||case when nullif(o.customer_name,'') is null then '' else ' · '||o.customer_name end,
 'order_payment'::text,p.id,p.created_at
from public.restaurant_order_payments p
join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id;
grant select on public.restaurant_cashbook_entries to authenticated;

create or replace function public.create_order_financial_snapshot(
 p_order_id uuid,p_restaurant_discount numeric default 0,p_platform_discount numeric default 0,
 p_tax_amount numeric default 0,p_delivery_fee numeric default 0,p_tip_amount numeric default 0
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype;v_subtotal numeric(14,2);v_commission_base numeric(14,2);
 v_rate numeric(5,2);v_commission numeric(14,2);v_customer_payable numeric(14,2);v_id uuid;v_can_adjust boolean;
begin
 if auth.uid() is null then raise exception 'Login required.'; end if;
 if coalesce(p_restaurant_discount,0)<0 or coalesce(p_platform_discount,0)<0 or coalesce(p_tax_amount,0)<0
  or coalesce(p_delivery_fee,0)<0 or coalesce(p_tip_amount,0)<0 then raise exception 'Discounts, tax, delivery and tip cannot be negative.'; end if;
 select * into v_order from public.orders where id=p_order_id;
 if not found then raise exception 'Order not found.'; end if;
 v_can_adjust:=public.is_platform_admin() or public.has_restaurant_role(v_order.restaurant_id,array['owner','manager']);
 if not (v_can_adjust or public.is_restaurant_member(v_order.restaurant_id)) then raise exception 'You do not have access to this restaurant.'; end if;
 if not v_can_adjust and (coalesce(p_restaurant_discount,0)<>0 or coalesce(p_platform_discount,0)<>0 or coalesce(p_tax_amount,0)<>0 or coalesce(p_delivery_fee,0)<>0 or coalesce(p_tip_amount,0)<>0) then
  raise exception 'Staff can create only a zero-adjustment financial snapshot. Ask an owner or manager to record adjustments.';
 end if;
 if exists(select 1 from public.order_financials where order_id=p_order_id) then raise exception 'A financial snapshot already exists for this order. Historical snapshots cannot be overwritten.'; end if;
 select coalesce(sum(oi.line_total),0)::numeric(14,2) into v_subtotal from public.order_items oi where oi.order_id=p_order_id;
 if v_subtotal<>round(v_order.amount,2) then raise exception 'Order total does not match its item subtotal. Resolve the order items before recording financials.'; end if;
 if coalesce(p_restaurant_discount,0)+coalesce(p_platform_discount,0)>v_subtotal then raise exception 'Combined discounts cannot exceed the food subtotal.'; end if;
 v_commission_base:=round(v_subtotal-coalesce(p_restaurant_discount,0),2);
 if v_order.channel='Own Platform' then v_rate:=18.00;
 elsif v_order.channel in ('Zomato (demo)','Swiggy (demo)','POS - Counter','POS - Takeaway','POS - Dine-in') then v_rate:=0.00;
 else raise exception 'Unknown order channel. No financial snapshot was created.'; end if;
 v_commission:=round(v_commission_base*v_rate/100,2);
 v_customer_payable:=round(v_subtotal-coalesce(p_restaurant_discount,0)-coalesce(p_platform_discount,0)+coalesce(p_tax_amount,0)+coalesce(p_delivery_fee,0)+coalesce(p_tip_amount,0),2);
 insert into public.order_financials(order_id,restaurant_id,channel,food_subtotal,restaurant_discount,platform_discount,commissionable_food_value,commission_rate,commission_amount,tax_amount,delivery_fee,tip_amount,customer_payable_amount,created_by)
 values(v_order.id,v_order.restaurant_id,v_order.channel,v_subtotal,coalesce(p_restaurant_discount,0),coalesce(p_platform_discount,0),v_commission_base,v_rate,v_commission,coalesce(p_tax_amount,0),coalesce(p_delivery_fee,0),coalesce(p_tip_amount,0),v_customer_payable,auth.uid())
 returning id into v_id;
 return v_id;
end;
$$;

create or replace function public.create_pos_order_with_payment(
 p_restaurant_id uuid,p_order_code text,p_channel text,p_customer_name text,p_customer_phone text,
 p_items jsonb,p_paid_amount numeric default 0,p_payment_method text default null,
 p_payment_date date default current_date,p_reference text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_order_id uuid;v_order_total numeric(14,2);
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','staff']) then raise exception 'Owner, Manager or Staff access required'; end if;
 if p_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then raise exception 'Invalid POS order type'; end if;
 if p_paid_amount is null or p_paid_amount<0 then raise exception 'Paid amount cannot be negative'; end if;
 if p_paid_amount>0 and p_payment_method not in ('Cash','UPI','Card','Bank Transfer','Other') then raise exception 'Select a valid payment method'; end if;
 if p_paid_amount>0 and p_payment_date is null then raise exception 'Payment date is required'; end if;
 v_order_id:=public.create_order_with_items(p_restaurant_id,p_order_code,p_channel,p_customer_name,p_customer_phone,p_items);
 select o.amount into v_order_total from public.orders o where o.id=v_order_id;
 if p_paid_amount>v_order_total then raise exception 'Paid amount cannot exceed order total'; end if;
 if p_paid_amount>0 then
  insert into public.restaurant_order_payments(order_id,restaurant_id,amount,payment_method,payment_date,reference,created_by)
  values(v_order_id,p_restaurant_id,p_paid_amount,p_payment_method,p_payment_date,nullif(p_reference,''),auth.uid());
 end if;
 return v_order_id;
end;
$$;
revoke all on function public.create_pos_order_with_payment(uuid,text,text,text,text,jsonb,numeric,text,date,text) from public,anon;
grant execute on function public.create_pos_order_with_payment(uuid,text,text,text,text,jsonb,numeric,text,date,text) to authenticated;
