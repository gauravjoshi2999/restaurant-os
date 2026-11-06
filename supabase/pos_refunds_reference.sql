-- RestaurantOS POS refunds reference SQL.
-- Applied to project wedbgpybbgsszcmffoha on 2026-11-06.
-- Refund entries record money already returned; this does not initiate bank/UPI transfers.

create table if not exists public.restaurant_order_refunds (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 order_id uuid not null references public.orders(id) on delete restrict,
 refund_date date not null default current_date,
 cancelled_sale_amount numeric(14,2) not null default 0 check (cancelled_sale_amount>=0),
 refund_amount numeric(14,2) not null default 0 check (refund_amount>=0),
 payment_method text,
 reason text not null,
 reference text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 constraint restaurant_order_refunds_nonzero check (cancelled_sale_amount>0 or refund_amount>0),
 constraint restaurant_order_refunds_reason check (length(btrim(reason)) between 2 and 500),
 constraint restaurant_order_refunds_method check (
  (refund_amount=0 and payment_method is null)
  or (refund_amount>0 and payment_method in ('Cash','UPI','Card','Bank Transfer','Other'))
 )
);

create index if not exists restaurant_order_refunds_order_idx on public.restaurant_order_refunds(restaurant_id,order_id,refund_date);
create index if not exists restaurant_order_refunds_date_idx on public.restaurant_order_refunds(restaurant_id,refund_date);
create index if not exists restaurant_order_refunds_order_fk_idx on public.restaurant_order_refunds(order_id);
create index if not exists restaurant_order_refunds_created_by_idx on public.restaurant_order_refunds(created_by);

alter table public.restaurant_order_refunds enable row level security;
drop policy if exists "Order refunds team read" on public.restaurant_order_refunds;
create policy "Order refunds team read" on public.restaurant_order_refunds for select to authenticated
using (public.has_restaurant_role(restaurant_id,array['owner','manager','staff']));
drop policy if exists "Order refunds owners insert" on public.restaurant_order_refunds;
create policy "Order refunds owners insert" on public.restaurant_order_refunds for insert to authenticated
with check (public.has_restaurant_role(restaurant_id,array['owner']) and created_by=(select auth.uid()));
grant select,insert on public.restaurant_order_refunds to authenticated;
revoke all on public.restaurant_order_refunds from anon;
revoke update,delete,truncate,references,trigger on public.restaurant_order_refunds from anon,authenticated;

create or replace function public.guard_restaurant_order_refund()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_order_total numeric(14,2); v_channel text; v_status text;
 v_paid_total numeric(14,2); v_prior_refund numeric(14,2); v_prior_cancelled numeric(14,2);
begin
 if auth.uid() is null or not public.has_restaurant_role(new.restaurant_id,array['owner']) then
  raise exception 'Only restaurant Owner can record refunds';
 end if;
 perform 1 from public.orders o where o.id=new.order_id and o.restaurant_id=new.restaurant_id for update;
 if not found then raise exception 'Order must belong to the same restaurant'; end if;
 select o.amount,o.channel,o.status into v_order_total,v_channel,v_status
 from public.orders o where o.id=new.order_id and o.restaurant_id=new.restaurant_id;
 if v_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then
  raise exception 'Refund recording is currently enabled only for POS orders';
 end if;
 if v_status not in ('Completed','Rejected','Cancelled') then
  raise exception 'Complete or cancel the order before recording a refund';
 end if;
 if new.created_by is distinct from auth.uid() then raise exception 'Refund creator must be the signed-in Owner'; end if;
 if new.refund_date is null then raise exception 'Refund date is required'; end if;
 if new.reason is null or length(btrim(new.reason))<2 then raise exception 'Refund reason is required'; end if;
 select coalesce(sum(p.amount),0) into v_paid_total from public.restaurant_order_payments p
 where p.order_id=new.order_id and p.restaurant_id=new.restaurant_id;
 select coalesce(sum(r.refund_amount),0),coalesce(sum(r.cancelled_sale_amount),0)
 into v_prior_refund,v_prior_cancelled from public.restaurant_order_refunds r
 where r.order_id=new.order_id and r.restaurant_id=new.restaurant_id;
 if new.refund_amount+v_prior_refund>v_paid_total then
  raise exception 'Refund cannot exceed the amount actually collected and not yet refunded';
 end if;
 if v_status='Completed' and new.refund_amount+v_prior_refund>new.cancelled_sale_amount+v_prior_cancelled then
  raise exception 'Returned money cannot exceed the sale amount cancelled';
 end if;
 if v_status in ('Rejected','Cancelled') and new.cancelled_sale_amount<>0 then
  raise exception 'Rejected or cancelled orders already have their sale reversed; enter only the actual refund amount';
 end if;
 if v_status='Completed' and new.cancelled_sale_amount+v_prior_cancelled>v_order_total then
  raise exception 'Cancelled sale amount cannot exceed the order total';
 end if;
 if exists(select 1 from public.restaurant_cashbook_closings c
  where c.restaurant_id=new.restaurant_id and c.close_date=new.refund_date) then
  raise exception 'This cashbook day is already closed';
 end if;
 return new;
end $$;
revoke all on function public.guard_restaurant_order_refund() from public,anon,authenticated;
drop trigger if exists restaurant_order_refunds_guard on public.restaurant_order_refunds;
create trigger restaurant_order_refunds_guard before insert on public.restaurant_order_refunds
for each row execute function public.guard_restaurant_order_refund();

create or replace function public.guard_restaurant_order_payment()
returns trigger language plpgsql set search_path=''
as $$
declare order_total numeric(14,2); order_channel text; order_status text;
 paid_total numeric(14,2); refund_total numeric(14,2); cancelled_total numeric(14,2);
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner','manager','staff']) then
  raise exception 'Restaurant team access required to record payment';
 end if;
 perform 1 from public.orders o where o.id=new.order_id and o.restaurant_id=new.restaurant_id for update;
 if not found then raise exception 'Order must belong to the same restaurant'; end if;
 select o.amount,o.channel,o.status into order_total,order_channel,order_status from public.orders o where o.id=new.order_id;
 if order_status in ('Rejected','Cancelled') then raise exception 'Cannot record a payment for a rejected or cancelled order'; end if;
 if order_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then
  raise exception 'Manual payment entry is only for POS orders; online platform payments are provider managed';
 end if;
 select coalesce(sum(p.amount),0) into paid_total from public.restaurant_order_payments p where p.order_id=new.order_id;
 select coalesce(sum(r.refund_amount),0),coalesce(sum(r.cancelled_sale_amount),0)
 into refund_total,cancelled_total from public.restaurant_order_refunds r
 where r.order_id=new.order_id and r.restaurant_id=new.restaurant_id;
 if paid_total-refund_total+new.amount>order_total-cancelled_total then
  raise exception 'Payment exceeds the remaining order balance';
 end if;
 if exists(select 1 from public.restaurant_cashbook_closings c
  where c.restaurant_id=new.restaurant_id and c.close_date=new.payment_date) then
  raise exception 'This cashbook day is already closed';
 end if;
 return new;
end $$;

create or replace view public.restaurant_order_payment_summaries with (security_invoker=true) as
with payments as (
 select p.order_id,p.restaurant_id,coalesce(sum(p.amount),0)::numeric(14,2) as paid_total
 from public.restaurant_order_payments p group by p.order_id,p.restaurant_id
), refunds as (
 select r.order_id,r.restaurant_id,coalesce(sum(r.refund_amount),0)::numeric(14,2) as refunded_amount,
  coalesce(sum(r.cancelled_sale_amount),0)::numeric(14,2) as cancelled_sale_amount
 from public.restaurant_order_refunds r group by r.order_id,r.restaurant_id
)
select o.id as order_id,o.restaurant_id,o.amount as order_total,
 greatest(coalesce(p.paid_total,0)-coalesce(r.refunded_amount,0),0)::numeric(14,2) as paid_amount,
 case when o.status=any(array['Rejected','Cancelled']) then 0::numeric(14,2)
 else greatest((o.amount-coalesce(r.cancelled_sale_amount,0))-(coalesce(p.paid_total,0)-coalesce(r.refunded_amount,0)),0)::numeric(14,2) end as balance_amount,
 case
  when o.status=any(array['Rejected','Cancelled']) then 'cancelled'::text
  when coalesce(r.cancelled_sale_amount,0)>=o.amount and coalesce(r.refunded_amount,0)>=coalesce(p.paid_total,0) and coalesce(p.paid_total,0)>0 then 'refunded'::text
  when coalesce(r.cancelled_sale_amount,0)>=o.amount then 'cancelled'::text
  when coalesce(r.refunded_amount,0)>0 then 'partially_refunded'::text
  when coalesce(p.paid_total,0)>=o.amount-coalesce(r.cancelled_sale_amount,0) and o.amount-coalesce(r.cancelled_sale_amount,0)>0 then 'paid'::text
  when coalesce(p.paid_total,0)>0 then 'partial'::text
  else 'unpaid'::text
 end as payment_status,
 greatest(o.amount-coalesce(r.cancelled_sale_amount,0),0)::numeric(14,2) as net_order_total,
 coalesce(r.refunded_amount,0)::numeric(14,2) as refunded_amount,
 coalesce(r.cancelled_sale_amount,0)::numeric(14,2) as cancelled_sale_amount
from public.orders o
left join payments p on p.order_id=o.id and p.restaurant_id=o.restaurant_id
left join refunds r on r.order_id=o.id and r.restaurant_id=o.restaurant_id;

create or replace view public.restaurant_customer_ledger with (security_invoker=true) as
select l.id as entry_id,l.restaurant_id,l.customer_id,c.full_name,c.phone,l.entry_date,l.entry_type,l.amount,
 l.payment_method,l.reference,l.description,l.created_at,'manual'::text as source_type,l.id as source_id
from public.restaurant_customer_ledger_entries l
join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
union all
select o.id,o.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,timezone('Asia/Kolkata',o.order_date)::date,
 'debit'::text,greatest(o.amount-coalesce(rt.cancelled_sale_amount,0),0)::numeric(14,2),null::text,o.order_code,
 'POS sale · '||replace(o.channel,'POS - ','') as description,o.created_at,'pos_order'::text,o.id
from public.orders o
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
left join (select order_id,restaurant_id,sum(cancelled_sale_amount)::numeric(14,2) as cancelled_sale_amount
 from public.restaurant_order_refunds group by order_id,restaurant_id) rt
 on rt.order_id=o.id and rt.restaurant_id=o.restaurant_id
where o.channel=any(array['POS - Counter','POS - Takeaway','POS - Dine-in'])
 and o.status<>all(array['Rejected','Cancelled']) and o.amount-coalesce(rt.cancelled_sale_amount,0)>0
union all
select p.id,p.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,p.payment_date,'credit'::text,p.amount,
 p.payment_method,p.reference,'POS payment · '||o.order_code,p.created_at,'pos_payment'::text,p.id
from public.restaurant_order_payments p
join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where o.channel=any(array['POS - Counter','POS - Takeaway','POS - Dine-in'])
union all
select r.id,r.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,r.refund_date,'debit'::text,r.refund_amount,
 r.payment_method,r.reference,'POS refund · '||o.order_code||' · '||r.reason,r.created_at,'pos_refund'::text,r.id
from public.restaurant_order_refunds r
join public.orders o on o.id=r.order_id and o.restaurant_id=r.restaurant_id
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where r.refund_amount>0;

create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as
select e.id,e.restaurant_id,e.expense_date,'out'::text,e.category,e.amount,e.payment_method,e.title,'expense'::text,e.id,e.created_at
from public.restaurant_expenses e
union all
select p.id,p.restaurant_id,p.purchase_date,'out'::text,'Purchase payment'::text,p.paid_amount,p.payment_method,
 coalesce(s.name,p.supplier_name_snapshot,'Purchase payment'::text),'purchase'::text,p.id,p.created_at
from public.restaurant_purchases p left join public.restaurant_suppliers s on s.id=p.supplier_id where p.paid_amount>0
union all
select m.id,m.restaurant_id,m.entry_date,m.direction,m.category,m.amount,m.payment_method,
 coalesce(m.description,m.category),'manual'::text,m.id,m.created_at from public.restaurant_cashbook_manual_entries m
union all
select p.id,p.restaurant_id,p.payment_date,'in'::text,'Order payment'::text,p.amount,p.payment_method,
 coalesce(o.order_code,'Order'::text)||case when nullif(o.customer_name,'') is null then '' else ' · '||o.customer_name end,
 'order_payment'::text,p.id,p.created_at
from public.restaurant_order_payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
union all
select ep.id,ep.restaurant_id,ep.payment_date,'out'::text,'Employee '||ep.payment_type,ep.amount,ep.payment_method,
 (coalesce(e.full_name,'Employee')||' · ')||ep.payment_type,'employee_payment'::text,ep.id,ep.created_at
from public.restaurant_employee_payments ep join public.restaurant_employees e on e.id=ep.employee_id and e.restaurant_id=ep.restaurant_id
where ep.payment_type=any(array['Salary','Advance','Bonus'])
union all
select l.id,l.restaurant_id,l.entry_date,'in'::text,'Customer collection'::text,l.amount,l.payment_method,
 coalesce(c.full_name,'Customer')||case when nullif(l.description,'') is null then '' else ' · '||l.description end,
 'customer_ledger_payment'::text,l.id,l.created_at
from public.restaurant_customer_ledger_entries l join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
where l.entry_type='credit'
union all
select r.id,r.restaurant_id,r.refund_date,'out'::text,'Customer refund'::text,r.refund_amount,r.payment_method,
 'Refund · '||o.order_code||' · '||r.reason,'order_refund'::text,r.id,r.created_at
from public.restaurant_order_refunds r join public.orders o on o.id=r.order_id and o.restaurant_id=r.restaurant_id
where r.refund_amount>0;
