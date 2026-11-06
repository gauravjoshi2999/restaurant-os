-- Reject/cancelled POS order safeguards.
-- Applied live 2026-11-06.

create or replace function public.guard_restaurant_order_payment()
returns trigger language plpgsql set search_path='' as $$
declare order_total numeric(14,2);order_channel text;order_status text;paid_total numeric(14,2);
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner','manager','staff']) then raise exception 'Restaurant team access required to record payment'; end if;
 perform 1 from public.orders o where o.id=new.order_id and o.restaurant_id=new.restaurant_id for update;
 if not found then raise exception 'Order must belong to the same restaurant'; end if;
 select o.amount,o.channel,o.status into order_total,order_channel,order_status from public.orders o where o.id=new.order_id;
 if order_status in ('Rejected','Cancelled') then raise exception 'Cannot record a payment for a rejected or cancelled order'; end if;
 if order_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then raise exception 'Manual payment entry is only for POS orders; online platform payments are provider managed'; end if;
 select coalesce(sum(p.amount),0) into paid_total from public.restaurant_order_payments p where p.order_id=new.order_id;
 if paid_total+new.amount>order_total then raise exception 'Payment exceeds order balance'; end if;
 if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.payment_date) then raise exception 'This cashbook day is already closed'; end if;
 return new;
end;
$$;

create or replace view public.restaurant_order_payment_summaries with (security_invoker=true) as
select o.id as order_id,o.restaurant_id,o.amount as order_total,
 coalesce(sum(p.amount),0)::numeric(14,2) as paid_amount,
 case when o.status in ('Rejected','Cancelled') then 0::numeric(14,2)
      else greatest(o.amount-coalesce(sum(p.amount),0),0)::numeric(14,2) end as balance_amount,
 case when o.status in ('Rejected','Cancelled') then 'cancelled'
      when coalesce(sum(p.amount),0)>=o.amount and o.amount>0 then 'paid'
      when coalesce(sum(p.amount),0)>0 then 'partial' else 'unpaid' end as payment_status
from public.orders o left join public.restaurant_order_payments p
 on p.order_id=o.id and p.restaurant_id=o.restaurant_id
group by o.id,o.restaurant_id,o.amount,o.status;
grant select on public.restaurant_order_payment_summaries to authenticated;

create or replace view public.restaurant_customer_ledger with (security_invoker=true) as
select l.id as entry_id,l.restaurant_id,l.customer_id,c.full_name,c.phone,l.entry_date,l.entry_type,l.amount,l.payment_method,l.reference,l.description,l.created_at,'manual'::text as source_type,l.id as source_id
from public.restaurant_customer_ledger_entries l join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
union all
select o.id,o.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,timezone('Asia/Kolkata',o.order_date)::date,'debit'::text,o.amount::numeric(14,2),null::text,o.order_code,('POS sale · '||replace(o.channel,'POS - ',''))::text,o.created_at,'pos_order'::text,o.id
from public.orders o join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where o.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in') and o.status not in ('Rejected','Cancelled')
union all
select p.id,p.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,p.payment_date,'credit'::text,p.amount::numeric(14,2),p.payment_method,p.reference,('POS payment · '||o.order_code)::text,p.created_at,'pos_payment'::text,p.id
from public.restaurant_order_payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where o.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in');
grant select on public.restaurant_customer_ledger to authenticated;
revoke all on function public.normalize_indian_phone(text) from public,anon;
grant execute on function public.normalize_indian_phone(text) to authenticated;
revoke all on function public.link_pos_order_customer() from public,anon;
grant execute on function public.link_pos_order_customer() to authenticated;
