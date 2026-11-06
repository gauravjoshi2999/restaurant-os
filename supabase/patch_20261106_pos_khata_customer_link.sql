-- Link POS orders and payments into the restaurant customer Khata.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- Existing orders.customer_id references auth.users; this adds a separate restaurant_customer_id.

alter table public.orders
 add column if not exists restaurant_customer_id uuid references public.restaurant_customers(id) on delete restrict;
create index if not exists orders_restaurant_customer_date_idx on public.orders(restaurant_customer_id,order_date desc);

create or replace function public.normalize_indian_phone(p_phone text)
returns text language sql immutable set search_path='' as $$
 select case
  when length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))=12 and left(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),2)='91'
   then right(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),10)
  when length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))=11 and left(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),1)='0'
   then right(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),10)
  else nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'')
 end;
$$;

create or replace function public.link_pos_order_customer()
returns trigger language plpgsql set search_path='' as $$
declare customer_restaurant uuid;
begin
 if tg_op='UPDATE' then
  if new.restaurant_customer_id is distinct from old.restaurant_customer_id then
   raise exception 'POS customer link cannot be changed after order creation';
  end if;
  return new;
 end if;
 if new.restaurant_customer_id is not null then
  select c.restaurant_id into customer_restaurant from public.restaurant_customers c
  where c.id=new.restaurant_customer_id and c.status='Active';
  if customer_restaurant is null or customer_restaurant<>new.restaurant_id then
   raise exception 'POS customer must belong to the same restaurant and be active';
  end if;
 elsif new.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in') and nullif(new.customer_phone,'') is not null then
  select c.id into new.restaurant_customer_id from public.restaurant_customers c
  where c.restaurant_id=new.restaurant_id
   and c.phone_normalized=public.normalize_indian_phone(new.customer_phone)
   and c.status='Active'
  limit 1;
 end if;
 return new;
end;
$$;
drop trigger if exists orders_link_restaurant_customer on public.orders;
create trigger orders_link_restaurant_customer before insert or update on public.orders
for each row execute function public.link_pos_order_customer();

update public.orders o set restaurant_customer_id=c.id
from public.restaurant_customers c
where o.restaurant_customer_id is null
 and o.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in')
 and c.restaurant_id=o.restaurant_id
 and c.phone_normalized=public.normalize_indian_phone(o.customer_phone)
 and c.status='Active';

create or replace view public.restaurant_customer_ledger with (security_invoker=true) as
select l.id as entry_id,l.restaurant_id,l.customer_id,c.full_name,c.phone,l.entry_date,l.entry_type,l.amount,
 l.payment_method,l.reference,l.description,l.created_at,'manual'::text as source_type,l.id as source_id
from public.restaurant_customer_ledger_entries l
join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
union all
select o.id,o.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,o.order_date::date,'debit'::text,
 o.amount::numeric(14,2),null::text,o.order_code,('POS sale · '||replace(o.channel,'POS - ',''))::text,o.created_at,
 'pos_order'::text,o.id
from public.orders o
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where o.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in')
union all
select p.id,p.restaurant_id,o.restaurant_customer_id,c.full_name,c.phone,p.payment_date,'credit'::text,
 p.amount::numeric(14,2),p.payment_method,p.reference,('POS payment · '||o.order_code)::text,p.created_at,
 'pos_payment'::text,p.id
from public.restaurant_order_payments p
join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
join public.restaurant_customers c on c.id=o.restaurant_customer_id and c.restaurant_id=o.restaurant_id
where o.channel in ('POS - Counter','POS - Takeaway','POS - Dine-in');
grant select on public.restaurant_customer_ledger to authenticated;

create or replace view public.restaurant_customer_balances with (security_invoker=true) as
select c.id as customer_id,c.restaurant_id,c.full_name,c.phone,c.status,
 coalesce(sum(case when l.entry_type='debit' then l.amount else -l.amount end),0)::numeric(14,2) as balance
from public.restaurant_customers c
left join public.restaurant_customer_ledger l on l.customer_id=c.id and l.restaurant_id=c.restaurant_id
group by c.id,c.restaurant_id,c.full_name,c.phone,c.status;
grant select on public.restaurant_customer_balances to authenticated;
