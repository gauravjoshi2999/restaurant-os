-- Customer Khata: customer master, debit/credit ledger, balances and Cashbook receipts.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- Reference patch; the live schema is authoritative.

create table if not exists public.restaurant_customers (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 full_name text not null check(length(btrim(full_name)) between 2 and 120),phone text,
 phone_normalized text generated always as (
  case
   when length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))=12 and left(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),2)='91'
    then right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10)
   when length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))=11 and left(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),1)='0'
    then right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10)
   else nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'')
  end
 ) stored,
 address text,notes text,status text not null default 'Active' check(status in ('Active','Inactive')),
 created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists restaurant_customers_phone_unique on public.restaurant_customers(restaurant_id,phone_normalized) where phone_normalized is not null;
create index if not exists restaurant_customers_rest_name_idx on public.restaurant_customers(restaurant_id,status,full_name);
create index if not exists restaurant_customers_created_by_idx on public.restaurant_customers(created_by);
alter table public.restaurant_customers enable row level security;
drop policy if exists "Customer accounts members read" on public.restaurant_customers;
create policy "Customer accounts members read" on public.restaurant_customers for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) or public.is_platform_admin());
drop policy if exists "Customer accounts team insert" on public.restaurant_customers;
create policy "Customer accounts team insert" on public.restaurant_customers for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) and created_by=(select auth.uid()));
drop policy if exists "Customer accounts managers update" on public.restaurant_customers;
create policy "Customer accounts managers update" on public.restaurant_customers for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Customer accounts owners delete" on public.restaurant_customers;
create policy "Customer accounts owners delete" on public.restaurant_customers for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());

create table if not exists public.restaurant_customer_ledger_entries (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 customer_id uuid not null references public.restaurant_customers(id) on delete restrict,entry_date date not null default current_date,
 entry_type text not null check(entry_type in ('debit','credit')),amount numeric(14,2) not null check(amount>0),
 payment_method text,reference text,description text,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),
 check((entry_type='debit' and (payment_method is null or payment_method='')) or (entry_type='credit' and payment_method in ('Cash','UPI','Card','Bank Transfer','Other')))
);
create index if not exists restaurant_customer_ledger_rest_date_idx on public.restaurant_customer_ledger_entries(restaurant_id,entry_date desc);
create index if not exists restaurant_customer_ledger_customer_date_idx on public.restaurant_customer_ledger_entries(customer_id,entry_date desc);
create index if not exists restaurant_customer_ledger_created_by_idx on public.restaurant_customer_ledger_entries(created_by);
alter table public.restaurant_customer_ledger_entries enable row level security;
drop policy if exists "Customer ledger members read" on public.restaurant_customer_ledger_entries;
create policy "Customer ledger members read" on public.restaurant_customer_ledger_entries for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) or public.is_platform_admin());
drop policy if exists "Customer ledger team insert" on public.restaurant_customer_ledger_entries;
create policy "Customer ledger team insert" on public.restaurant_customer_ledger_entries for insert to authenticated
with check(public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) and created_by=(select auth.uid())
 and exists(select 1 from public.restaurant_customers c where c.id=restaurant_customer_ledger_entries.customer_id and c.restaurant_id=restaurant_customer_ledger_entries.restaurant_id));
grant select,insert,update,delete on public.restaurant_customers to authenticated;
grant select,insert on public.restaurant_customer_ledger_entries to authenticated;
revoke update,delete on public.restaurant_customer_ledger_entries from authenticated,anon;

create or replace function public.set_restaurant_customer_updated_at()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now();return new;end;$$;
drop trigger if exists restaurant_customers_updated_at on public.restaurant_customers;
create trigger restaurant_customers_updated_at before update on public.restaurant_customers for each row execute function public.set_restaurant_customer_updated_at();
create or replace function public.guard_restaurant_customer_identity()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='UPDATE' and (new.restaurant_id is distinct from old.restaurant_id or new.created_by is distinct from old.created_by) then raise exception 'Customer account ownership fields are immutable'; end if;
 return new;end;$$;
drop trigger if exists restaurant_customers_identity_guard on public.restaurant_customers;
create trigger restaurant_customers_identity_guard before update on public.restaurant_customers for each row execute function public.guard_restaurant_customer_identity();

create or replace function public.guard_customer_ledger_entry()
returns trigger language plpgsql set search_path='' as $$
declare customer_restaurant uuid;
begin
 if not public.has_restaurant_role(new.restaurant_id,array['owner','manager','staff']) then raise exception 'Restaurant team access required'; end if;
 select c.restaurant_id into customer_restaurant from public.restaurant_customers c where c.id=new.customer_id for update;
 if customer_restaurant is null or customer_restaurant<>new.restaurant_id then raise exception 'Customer must belong to the same restaurant'; end if;
 if exists(select 1 from public.restaurant_cashbook_closings c where c.restaurant_id=new.restaurant_id and c.close_date=new.entry_date) then raise exception 'This cashbook day is already closed'; end if;
 return new;
end;
$$;
drop trigger if exists restaurant_customer_ledger_guard on public.restaurant_customer_ledger_entries;
create trigger restaurant_customer_ledger_guard before insert on public.restaurant_customer_ledger_entries for each row execute function public.guard_customer_ledger_entry();

create or replace view public.restaurant_customer_ledger with (security_invoker=true) as
select l.id as entry_id,l.restaurant_id,l.customer_id,c.full_name,c.phone,l.entry_date,l.entry_type,l.amount,l.payment_method,l.reference,l.description,l.created_at
from public.restaurant_customer_ledger_entries l join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id;
grant select on public.restaurant_customer_ledger to authenticated;
create or replace view public.restaurant_customer_balances with (security_invoker=true) as
select c.id as customer_id,c.restaurant_id,c.full_name,c.phone,c.status,
 coalesce(sum(case when l.entry_type='debit' then l.amount else -l.amount end),0)::numeric(14,2) as balance
from public.restaurant_customers c left join public.restaurant_customer_ledger_entries l on l.customer_id=c.id and l.restaurant_id=c.restaurant_id
group by c.id,c.restaurant_id,c.full_name,c.phone,c.status;
grant select on public.restaurant_customer_balances to authenticated;

-- Rebuild Cashbook view with all recorded financial sources.
create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as
select e.id as entry_id,e.restaurant_id,e.expense_date as entry_date,'out'::text as direction,e.category,e.amount,e.payment_method,e.title as description,'expense'::text as source_type,e.id as source_id,e.created_at from public.restaurant_expenses e
union all
select p.id,p.restaurant_id,p.purchase_date,'out'::text,'Purchase payment'::text,p.paid_amount,p.payment_method,coalesce(s.name,p.supplier_name_snapshot,'Purchase payment')::text,'purchase'::text,p.id,p.created_at from public.restaurant_purchases p left join public.restaurant_suppliers s on s.id=p.supplier_id where p.paid_amount>0
union all
select m.id,m.restaurant_id,m.entry_date,m.direction,m.category,m.amount,m.payment_method,coalesce(m.description,m.category),'manual'::text,m.id,m.created_at from public.restaurant_cashbook_manual_entries m
union all
select p.id,p.restaurant_id,p.payment_date,'in'::text,'Order payment'::text,p.amount,p.payment_method,coalesce(o.order_code,'Order')||case when nullif(o.customer_name,'') is null then '' else ' · '||o.customer_name end,'order_payment'::text,p.id,p.created_at from public.restaurant_order_payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
union all
select ep.id,ep.restaurant_id,ep.payment_date,'out'::text,'Employee '||ep.payment_type,ep.amount,ep.payment_method,coalesce(e.full_name,'Employee')||' · '||ep.payment_type,'employee_payment'::text,ep.id,ep.created_at from public.restaurant_employee_payments ep join public.restaurant_employees e on e.id=ep.employee_id and e.restaurant_id=ep.restaurant_id where ep.payment_type in ('Salary','Advance','Bonus')
union all
select l.id,l.restaurant_id,l.entry_date,'in'::text,'Customer collection'::text,l.amount,l.payment_method,
 coalesce(c.full_name,'Customer')||case when nullif(l.description,'') is null then '' else ' · '||l.description end,
 'customer_ledger_payment'::text,l.id,l.created_at
from public.restaurant_customer_ledger_entries l join public.restaurant_customers c on c.id=l.customer_id and c.restaurant_id=l.restaurant_id
where l.entry_type='credit';
grant select on public.restaurant_cashbook_entries to authenticated;
