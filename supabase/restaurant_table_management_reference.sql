-- RestaurantOS Table Management reference
-- Applied to Supabase project wedbgpybbgsszcmffoha on 2026-11-06.
-- Re-applying is intended to be idempotent where practical; review before use.

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_name text not null,
  area text not null default 'Main',
  seats integer not null default 2 check (seats between 1 and 50),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_tables_name_unique unique (restaurant_id, table_name),
  constraint restaurant_tables_id_restaurant_unique unique (id, restaurant_id)
);

alter table public.orders add column if not exists table_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='orders_table_restaurant_fk' and conrelid='public.orders'::regclass) then
    alter table public.orders add constraint orders_table_restaurant_fk
      foreign key (table_id, restaurant_id)
      references public.restaurant_tables(id, restaurant_id) on delete restrict;
  end if;
end $$;

create index if not exists restaurant_tables_restaurant_active_idx on public.restaurant_tables(restaurant_id,is_active,sort_order);
create index if not exists orders_table_status_idx on public.orders(restaurant_id,table_id,status) where table_id is not null;
create index if not exists orders_table_restaurant_fk_idx on public.orders(table_id,restaurant_id);
create index if not exists restaurant_tables_created_by_idx on public.restaurant_tables(created_by);

alter table public.restaurant_tables enable row level security;
drop policy if exists "Restaurant tables members read" on public.restaurant_tables;
create policy "Restaurant tables members read" on public.restaurant_tables for select to authenticated
using (public.has_restaurant_role(restaurant_id,array['owner','manager','staff']) or public.is_platform_admin());
drop policy if exists "Restaurant tables managers insert" on public.restaurant_tables;
create policy "Restaurant tables managers insert" on public.restaurant_tables for insert to authenticated
with check (public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()));
drop policy if exists "Restaurant tables managers update" on public.restaurant_tables;
create policy "Restaurant tables managers update" on public.restaurant_tables for update to authenticated
using (public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
with check (public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
drop policy if exists "Restaurant tables owners delete" on public.restaurant_tables;
create policy "Restaurant tables owners delete" on public.restaurant_tables for delete to authenticated
using (public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());
grant select,insert,update,delete on public.restaurant_tables to authenticated;
revoke all on public.restaurant_tables from anon;

create or replace function public.validate_order_table_assignment()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_active boolean;
begin
 if new.table_id is null then return new; end if;
 if new.channel<>'POS - Dine-in' then raise exception 'A table can only be assigned to a POS Dine-in order'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.table_id::text,0));
 select t.is_active into v_active from public.restaurant_tables t
 where t.id=new.table_id and t.restaurant_id=new.restaurant_id;
 if not found or not coalesce(v_active,false) then raise exception 'Selected table is not active for this restaurant'; end if;
 if exists(select 1 from public.orders o where o.restaurant_id=new.restaurant_id and o.table_id=new.table_id
   and o.id is distinct from new.id and o.status not in ('Completed','Rejected','Cancelled')) then
  raise exception 'This table is already occupied by an active order';
 end if;
 return new;
end $$;
revoke all on function public.validate_order_table_assignment() from public,anon,authenticated;
drop trigger if exists orders_validate_table_assignment on public.orders;
create trigger orders_validate_table_assignment before insert or update of table_id,restaurant_id,channel
on public.orders for each row execute function public.validate_order_table_assignment();

create or replace function public.prevent_deactivating_occupied_table()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if old.is_active and not new.is_active and exists(
  select 1 from public.orders o where o.restaurant_id=old.restaurant_id and o.table_id=old.id
  and o.status not in ('Completed','Rejected','Cancelled')
 ) then raise exception 'Cannot deactivate an occupied table'; end if;
 return new;
end $$;
revoke all on function public.prevent_deactivating_occupied_table() from public,anon,authenticated;
drop trigger if exists restaurant_tables_prevent_occupied_deactivation on public.restaurant_tables;
create trigger restaurant_tables_prevent_occupied_deactivation before update of is_active
on public.restaurant_tables for each row execute function public.prevent_deactivating_occupied_table();

-- The assignment helper lives outside the exposed public schema. Only authenticated
-- restaurant members can execute it; it re-checks membership before inserting orders.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create or replace function private.create_order_with_items_and_table(
 p_restaurant_id uuid,p_order_code text,p_channel text,p_customer_name text,
 p_customer_phone text,p_items jsonb,p_table_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_order_id uuid; v_item jsonb; v_name text; v_quantity numeric(10,2);
 v_unit_price numeric(12,2); v_total numeric(14,2):=0;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','staff']) then
  raise exception 'Owner, Manager or Staff access required';
 end if;
 if p_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then raise exception 'Invalid POS order type'; end if;
 if p_table_id is not null and p_channel<>'POS - Dine-in' then raise exception 'Table assignment is only valid for Dine-in'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one order item'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_name:=nullif(btrim(v_item->>'name'),''); v_quantity:=(v_item->>'quantity')::numeric; v_unit_price:=(v_item->>'unit_price')::numeric;
  if v_name is null then raise exception 'Every item needs a name'; end if;
  if v_quantity is null or v_quantity<=0 then raise exception 'Item quantity must be greater than zero'; end if;
  if v_unit_price is null or v_unit_price<0 then raise exception 'Item price cannot be negative'; end if;
  v_total:=v_total+round(v_quantity*v_unit_price,2);
 end loop;
 insert into public.orders(restaurant_id,order_code,channel,amount,status,customer_name,customer_phone,created_by,table_id)
 values(p_restaurant_id,p_order_code,p_channel,v_total,'Received',nullif(btrim(p_customer_name),''),nullif(btrim(p_customer_phone),''),auth.uid(),p_table_id)
 returning id into v_order_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  insert into public.order_items(order_id,item_name,quantity,unit_price)
  values(v_order_id,btrim(v_item->>'name'),(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
 end loop;
 perform public.create_order_financial_snapshot(v_order_id);
 return v_order_id;
end $$;
revoke all on function private.create_order_with_items_and_table(uuid,text,text,text,text,jsonb,uuid) from public,anon;
grant execute on function private.create_order_with_items_and_table(uuid,text,text,text,text,jsonb,uuid) to authenticated;

create or replace function public.create_pos_order_with_payment(
 p_restaurant_id uuid,p_order_code text,p_channel text,p_customer_name text,p_customer_phone text,
 p_items jsonb,p_paid_amount numeric default 0,p_payment_method text default null,
 p_payment_date date default current_date,p_reference text default null,p_table_id uuid default null
)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare v_order_id uuid; v_order_total numeric(14,2);
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','staff']) then raise exception 'Owner, Manager or Staff access required'; end if;
 if p_channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in') then raise exception 'Invalid POS order type'; end if;
 if p_paid_amount is null or p_paid_amount<0 then raise exception 'Paid amount cannot be negative'; end if;
 if p_paid_amount>0 and p_payment_method not in ('Cash','UPI','Card','Bank Transfer','Other') then raise exception 'Select a valid payment method'; end if;
 if p_paid_amount>0 and p_payment_date is null then raise exception 'Payment date is required'; end if;
 if p_table_id is not null and p_channel<>'POS - Dine-in' then raise exception 'Table assignment is only valid for Dine-in'; end if;
 v_order_id:=private.create_order_with_items_and_table(p_restaurant_id,p_order_code,p_channel,p_customer_name,p_customer_phone,p_items,p_table_id);
 select o.amount into v_order_total from public.orders o where o.id=v_order_id;
 if p_paid_amount>v_order_total then raise exception 'Paid amount cannot exceed order total'; end if;
 if p_paid_amount>0 then
  insert into public.restaurant_order_payments(order_id,restaurant_id,amount,payment_method,payment_date,reference,created_by)
  values(v_order_id,p_restaurant_id,p_paid_amount,p_payment_method,p_payment_date,nullif(p_reference,''),auth.uid());
 end if;
 return v_order_id;
end $$;
revoke all on function public.create_pos_order_with_payment(uuid,text,text,text,text,jsonb,numeric,text,date,text,uuid) from public,anon;
grant execute on function public.create_pos_order_with_payment(uuid,text,text,text,text,jsonb,numeric,text,date,text,uuid) to authenticated;
