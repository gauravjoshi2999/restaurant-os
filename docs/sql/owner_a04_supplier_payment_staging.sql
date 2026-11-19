-- Bite Owner V3 / A04 supplier payments: payment day stays distinct from purchase day.
-- Safe, additive source: legacy restaurant_purchases.paid_amount remains initial
-- paid-at-purchase amount (no historical guessing / backfill).
-- Apply after matching isolated PostgreSQL 17 QA; not part of GitHub Pages deploy.
create unique index if not exists restaurant_purchases_tenant_id_unique
 on public.restaurant_purchases(restaurant_id,id);
create table if not exists public.restaurant_supplier_payments(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null,
 purchase_id uuid not null,
 constraint restaurant_supplier_payments_purchase_scope_fkey
  foreign key (restaurant_id,purchase_id) references public.restaurant_purchases(restaurant_id,id) on delete restrict,
 payment_date date not null,
 amount numeric(14,2) not null check (amount>0 and amount=round(amount,2)),
 method text not null check (method in ('Cash','UPI','Card','Bank Transfer')),
 reference text not null default '' check (length(reference)<=100),
 request_id uuid not null unique,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now()
);
create index if not exists restaurant_supplier_payments_purchase_idx
 on public.restaurant_supplier_payments(restaurant_id,purchase_id,payment_date desc);
alter table public.restaurant_supplier_payments enable row level security;
revoke all on public.restaurant_supplier_payments from public,anon,authenticated;
grant select on public.restaurant_supplier_payments to authenticated;
drop policy if exists restaurant_supplier_payment_read on public.restaurant_supplier_payments;
create policy restaurant_supplier_payment_read on public.restaurant_supplier_payments
 for select to authenticated using (
  public.has_restaurant_role(restaurant_id,array['owner','manager'])
 );

-- Immutable settled payments. Existing purchase/stock and payment APIs remain intact.
-- When a purchase has a separate payment, its historical paid-at-purchase amount,
-- purchase day and total cannot be silently rewritten.
create or replace function public.bite_guard_supplier_paid_purchase()
returns trigger language plpgsql security definer set search_path='' as $
declare later_total numeric;
begin
 select coalesce(sum(amount),0) into later_total
 from public.restaurant_supplier_payments
 where purchase_id=old.id and restaurant_id=old.restaurant_id;
 if later_total>0 and (
    new.restaurant_id is distinct from old.restaurant_id or
    new.purchase_date is distinct from old.purchase_date or
    new.paid_amount is distinct from old.paid_amount or
    new.total_amount < old.paid_amount+later_total
 ) then
   raise exception 'This purchase has supplier payments. Change only non-financial details; record further payments separately.';
 end if;
 return new;
end $;
revoke all on function public.bite_guard_supplier_paid_purchase() from public,anon,authenticated;
drop trigger if exists restaurant_supplier_paid_purchase_guard on public.restaurant_purchases;
create trigger restaurant_supplier_paid_purchase_guard
 before update on public.restaurant_purchases
 for each row execute function public.bite_guard_supplier_paid_purchase();

-- One idempotent, tenant-authenticated payment write. No direct INSERT/UPDATE/DELETE.
create or replace function public.record_restaurant_supplier_payment(
 p_restaurant_id uuid,p_purchase_id uuid,p_amount numeric,p_payment_date date,
 p_method text,p_request_id uuid,p_reference text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare purchase_row public.restaurant_purchases%rowtype;
 prior public.restaurant_supplier_payments%rowtype;
 prior_total numeric(14,2);
 new_id uuid;
begin
 if auth.uid() is null or p_request_id is null or p_restaurant_id is null or p_purchase_id is null then
   raise exception 'Authenticated owner request required' using errcode='42501';
 end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner']) then
   raise exception 'Restaurant owner permission required' using errcode='42501';
 end if;
 if p_amount is null or p_amount<=0 or p_amount>9999999999.99 or p_amount<>round(p_amount,2) then
   raise exception 'Enter a positive amount with at most two decimals';
 end if;
 if p_method not in ('Cash','UPI','Card','Bank Transfer') or p_method is null then
   raise exception 'Choose a supported payment method';
 end if;
 if p_payment_date is null or p_payment_date>(now() at time zone 'Asia/Kolkata')::date then
   raise exception 'Payment date must not be in the future';
 end if;
 if length(coalesce(p_reference,''))>100 then raise exception 'Reference is too long'; end if;

 select * into purchase_row from public.restaurant_purchases
 where id=p_purchase_id and restaurant_id=p_restaurant_id for update;
 if not found then raise exception 'Supplier purchase not found or belongs to another business' using errcode='42501'; end if;

 -- Retry safety: same request returns the same result without another cashbook row.
 select * into prior from public.restaurant_supplier_payments where request_id=p_request_id;
 if found then
   if prior.restaurant_id<>p_restaurant_id or prior.purchase_id<>p_purchase_id
      or prior.amount<>p_amount or prior.payment_date<>p_payment_date
      or prior.method<>p_method or prior.reference<>trim(coalesce(p_reference,''))
      or prior.created_by<>auth.uid() then
      raise exception 'Request ID was already used for a different supplier payment';
   end if;
   return prior.id;
 end if;

 if p_payment_date<purchase_row.purchase_date then
   raise exception 'Payment date cannot be earlier than the purchase date';
 end if;
 if exists(select 1 from public.restaurant_cashbook_closings c
    where c.restaurant_id=p_restaurant_id and c.close_date=p_payment_date)
    or exists(select 1 from public.bite_property_shift_closings c
      join public.bite_property_outlets o on o.property_id=c.property_id
      where o.restaurant_id=p_restaurant_id and c.shift_date=p_payment_date and c.locked)
 then raise exception 'Payment day is closed. Make a documented correction on an open date'; end if;

 select coalesce(sum(amount),0) into prior_total
 from public.restaurant_supplier_payments
 where purchase_id=p_purchase_id and restaurant_id=p_restaurant_id;
 if p_amount>purchase_row.total_amount-purchase_row.paid_amount-prior_total then
   raise exception 'Supplier payment exceeds the outstanding due';
 end if;
 insert into public.restaurant_supplier_payments(
  restaurant_id,purchase_id,payment_date,amount,method,reference,request_id,created_by)
 values(p_restaurant_id,p_purchase_id,p_payment_date,p_amount,p_method,trim(coalesce(p_reference,'')),p_request_id,auth.uid())
 returning id into new_id;
 return new_id;
end $$;
revoke all on function public.record_restaurant_supplier_payment(uuid,uuid,numeric,date,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_restaurant_supplier_payment(uuid,uuid,numeric,date,text,uuid,text) to authenticated;

-- Preserve the CURRENT production seven-source invoker view. Append precisely one
-- payment-day source without redefining unrelated POS, salary or refund branches.
-- The existing 'purchase' source is the initial paid_amount on purchase_date.
do $$
declare base_sql text;
begin
 select pg_get_viewdef('public.restaurant_cashbook_entries'::regclass,true) into base_sql;
 if position('restaurant_supplier_payments' in base_sql)>0 then
   raise exception 'Supplier payments already exist in cashbook view; verify existing migration first';
 end if;
 base_sql:=regexp_replace(base_sql,';[[:space:]]*$','');
 execute 'create or replace view public.restaurant_cashbook_entries with (security_invoker=true) as '||
  base_sql||
  ' union all select sp.id as entry_id,sp.restaurant_id,sp.payment_date as entry_date,'||
  '''out''::text as direction,''Supplier payment''::text as category,sp.amount,'||
  'sp.method as payment_method,coalesce(s.name,p.supplier_name_snapshot,''Supplier'')::text as description,'||
  '''supplier_payment''::text as source_type,sp.purchase_id as source_id,sp.created_at '||
  'from public.restaurant_supplier_payments sp '||
  'join public.restaurant_purchases p on p.id=sp.purchase_id and p.restaurant_id=sp.restaurant_id '||
  'left join public.restaurant_suppliers s on s.id=p.supplier_id';
end $$;
comment on table public.restaurant_supplier_payments is
 'Append-only payments against supplier purchase dues. Initial paid_amount remains dated on the original purchase date. Do not double record in restaurant_expenses.';
