-- Purchase to Inventory automatic stock posting.
-- Applied to live Supabase with execute_sql on 2026-11-06.
-- This patch is kept in GitHub as the reproducible reference; Supabase live schema is authoritative.

-- Correct tenant-correlated RLS checks. The explicit outer-table qualifiers are important.
drop policy if exists "Purchase items managers insert" on public.restaurant_purchase_items;
create policy "Purchase items managers insert"
on public.restaurant_purchase_items for insert to authenticated
with check (
 (public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin())
 and exists (
  select 1 from public.restaurant_purchases p
  where p.id=restaurant_purchase_items.purchase_id
    and p.restaurant_id=restaurant_purchase_items.restaurant_id
 )
);
drop policy if exists "Purchase items managers update" on public.restaurant_purchase_items;
drop policy if exists "Purchase items owners update" on public.restaurant_purchase_items;
create policy "Purchase items owners update"
on public.restaurant_purchase_items for update to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin())
with check (
 (public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin())
 and exists (
  select 1 from public.restaurant_purchases p
  where p.id=restaurant_purchase_items.purchase_id
    and p.restaurant_id=restaurant_purchase_items.restaurant_id
 )
);
drop policy if exists "Purchases managers update" on public.restaurant_purchases;
drop policy if exists "Purchases owners update" on public.restaurant_purchases;
create policy "Purchases owners update"
on public.restaurant_purchases for update to authenticated
using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin())
with check(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());
drop policy if exists "Stock movements managers insert" on public.restaurant_stock_movements;
create policy "Stock movements managers insert"
on public.restaurant_stock_movements for insert to authenticated
with check (
 public.has_restaurant_role(restaurant_id,array['owner','manager'])
 and created_by=(select auth.uid())
 and exists (
  select 1 from public.restaurant_inventory_items i
  where i.id=restaurant_stock_movements.inventory_item_id
    and i.restaurant_id=restaurant_stock_movements.restaurant_id
 )
);

alter table public.restaurant_purchase_items
 add column if not exists inventory_item_id uuid references public.restaurant_inventory_items(id) on delete restrict;
create index if not exists restaurant_purchase_items_inventory_item_idx
 on public.restaurant_purchase_items(inventory_item_id);
alter table public.restaurant_stock_movements
 add column if not exists purchase_item_id uuid references public.restaurant_purchase_items(id) on delete restrict;
create unique index if not exists restaurant_stock_movements_purchase_item_unique
 on public.restaurant_stock_movements(purchase_item_id) where purchase_item_id is not null;

create or replace function public.guard_purchase_item_inventory_link()
returns trigger language plpgsql set search_path='' as $$
declare purchase_restaurant uuid; item_restaurant uuid; item_unit text;
begin
 select p.restaurant_id into purchase_restaurant
 from public.restaurant_purchases p where p.id=new.purchase_id;
 if purchase_restaurant is null or purchase_restaurant<>new.restaurant_id then
  raise exception 'Purchase item and purchase must belong to the same restaurant';
 end if;
 if new.inventory_item_id is not null then
  select i.restaurant_id,i.unit into item_restaurant,item_unit
  from public.restaurant_inventory_items i
  where i.id=new.inventory_item_id and i.is_active;
  if item_restaurant is null or item_restaurant<>new.restaurant_id then
   raise exception 'Mapped inventory item must belong to the same restaurant and be active';
  end if;
  if lower(btrim(item_unit))<>lower(btrim(new.unit)) then
   raise exception 'Purchase unit must match inventory item unit';
  end if;
 end if;
 if tg_op='UPDATE' and exists(
  select 1 from public.restaurant_stock_movements m where m.purchase_item_id=old.id
 ) then
  if new.purchase_id is distinct from old.purchase_id
   or new.restaurant_id is distinct from old.restaurant_id
   or new.inventory_item_id is distinct from old.inventory_item_id
   or new.quantity is distinct from old.quantity
   or new.unit is distinct from old.unit
   or new.unit_cost is distinct from old.unit_cost
   or new.item_name is distinct from old.item_name then
   raise exception 'A purchase item already posted to stock cannot be changed';
  end if;
 end if;
 return new;
end;
$$;
drop trigger if exists restaurant_purchase_items_inventory_guard on public.restaurant_purchase_items;
create trigger restaurant_purchase_items_inventory_guard
before insert or update on public.restaurant_purchase_items
for each row execute function public.guard_purchase_item_inventory_link();

create or replace function public.record_purchase_item_stock_movement()
returns trigger language plpgsql set search_path='' as $$
declare p_date date; p_invoice text; p_supplier text; p_creator uuid;
begin
 if new.inventory_item_id is null then return new; end if;
 select p.purchase_date,p.invoice_number,p.created_by,
        coalesce(s.name,p.supplier_name_snapshot,'Supplier not specified')
 into p_date,p_invoice,p_creator,p_supplier
 from public.restaurant_purchases p
 left join public.restaurant_suppliers s on s.id=p.supplier_id
 where p.id=new.purchase_id and p.restaurant_id=new.restaurant_id;
 if p_date is null then raise exception 'Purchase header not found for stock posting'; end if;
 insert into public.restaurant_stock_movements(
  restaurant_id,inventory_item_id,purchase_item_id,movement_type,quantity,unit_cost,
  movement_date,reference,notes,created_by
 ) values (
  new.restaurant_id,new.inventory_item_id,new.id,'purchase',new.quantity,new.unit_cost,
  p_date,coalesce(nullif(p_invoice,''),'Purchase '||left(new.purchase_id::text,8)),
  'Supplier: '||p_supplier||'; Item: '||new.item_name,coalesce(auth.uid(),p_creator)
 );
 return new;
end;
$$;
drop trigger if exists restaurant_purchase_items_post_stock on public.restaurant_purchase_items;
create trigger restaurant_purchase_items_post_stock
after insert or update of inventory_item_id on public.restaurant_purchase_items
for each row execute function public.record_purchase_item_stock_movement();

create or replace function public.guard_purchase_with_stock_postings()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (
  new.id is distinct from old.id
  or new.restaurant_id is distinct from old.restaurant_id
  or new.created_by is distinct from old.created_by
 ) then
  raise exception 'Purchase identity and ownership fields are immutable';
 end if;
 if exists (
  select 1 from public.restaurant_purchase_items pi
  join public.restaurant_stock_movements sm on sm.purchase_item_id=pi.id
  where pi.purchase_id=old.id
 ) then
  if tg_op='DELETE' then raise exception 'Purchase already posted to inventory cannot be deleted'; end if;
  if new.supplier_id is distinct from old.supplier_id
   or new.supplier_name_snapshot is distinct from old.supplier_name_snapshot
   or new.purchase_date is distinct from old.purchase_date
   or new.invoice_number is distinct from old.invoice_number
   or new.total_amount is distinct from old.total_amount then
   raise exception 'Purchase details linked to stock cannot be changed; only payment and notes may be updated';
  end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists restaurant_purchases_stock_guard on public.restaurant_purchases;
create trigger restaurant_purchases_stock_guard
before update or delete on public.restaurant_purchases
for each row execute function public.guard_purchase_with_stock_postings();

create or replace function public.save_restaurant_purchase(
 p_restaurant_id uuid,p_purchase_id uuid,p_header jsonb,p_items jsonb
) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_purchase_id uuid; v_total numeric(14,2); v_paid numeric(14,2); v_linked boolean:=false;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager']) then
  raise exception 'Owner or Manager access required';
 end if;
 if jsonb_typeof(p_header)<>'object' or jsonb_typeof(p_items)<>'array'
  or jsonb_array_length(p_items)=0 then
  raise exception 'Purchase header and at least one item are required';
 end if;
 v_total:=(p_header->>'total_amount')::numeric;
 v_paid:=(p_header->>'paid_amount')::numeric;
 if v_total<0 or v_paid<0 or v_paid>v_total then raise exception 'Invalid purchase or paid amount'; end if;

 if p_purchase_id is null then
  insert into public.restaurant_purchases(
   restaurant_id,supplier_id,supplier_name_snapshot,purchase_date,invoice_number,
   total_amount,paid_amount,payment_method,notes,created_by
  ) values (
   p_restaurant_id,nullif(p_header->>'supplier_id','')::uuid,
   nullif(p_header->>'supplier_name_snapshot',''),(p_header->>'purchase_date')::date,
   nullif(p_header->>'invoice_number',''),v_total,v_paid,p_header->>'payment_method',
   nullif(p_header->>'notes',''),auth.uid()
  ) returning id into v_purchase_id;
 else
  if not public.has_restaurant_role(p_restaurant_id,array['owner']) then
   raise exception 'Only Owner can edit an existing purchase';
  end if;
  perform 1 from public.restaurant_purchases p
   where p.id=p_purchase_id and p.restaurant_id=p_restaurant_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  select exists(
   select 1 from public.restaurant_purchase_items pi
   join public.restaurant_stock_movements sm on sm.purchase_item_id=pi.id
   where pi.purchase_id=p_purchase_id
  ) into v_linked;
  if v_linked then
   if exists(
    select pi.item_name,pi.quantity,pi.unit,pi.unit_cost,pi.inventory_item_id
    from public.restaurant_purchase_items pi where pi.purchase_id=p_purchase_id
    except
    select x.item_name,x.quantity,coalesce(nullif(x.unit,''),'pcs'),x.unit_cost,x.inventory_item_id
    from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit text,unit_cost numeric,inventory_item_id uuid)
   ) or exists(
    select x.item_name,x.quantity,coalesce(nullif(x.unit,''),'pcs'),x.unit_cost,x.inventory_item_id
    from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit text,unit_cost numeric,inventory_item_id uuid)
    except
    select pi.item_name,pi.quantity,pi.unit,pi.unit_cost,pi.inventory_item_id
    from public.restaurant_purchase_items pi where pi.purchase_id=p_purchase_id
   ) then
    raise exception 'Purchase items already posted to stock cannot be changed';
   end if;
  end if;
  update public.restaurant_purchases p set
   supplier_id=nullif(p_header->>'supplier_id','')::uuid,
   supplier_name_snapshot=nullif(p_header->>'supplier_name_snapshot',''),
   purchase_date=(p_header->>'purchase_date')::date,
   invoice_number=nullif(p_header->>'invoice_number',''),
   total_amount=v_total,paid_amount=v_paid,payment_method=p_header->>'payment_method',
   notes=nullif(p_header->>'notes','')
  where p.id=p_purchase_id and p.restaurant_id=p_restaurant_id;
  if not v_linked then
   delete from public.restaurant_purchase_items pi
   where pi.purchase_id=p_purchase_id and pi.restaurant_id=p_restaurant_id;
  end if;
  v_purchase_id:=p_purchase_id;
 end if;
 if not v_linked then
  insert into public.restaurant_purchase_items(
   purchase_id,restaurant_id,item_name,quantity,unit,unit_cost,inventory_item_id
  )
  select v_purchase_id,p_restaurant_id,x.item_name,x.quantity,
   coalesce(nullif(x.unit,''),'pcs'),x.unit_cost,x.inventory_item_id
  from jsonb_to_recordset(p_items) as x(
   item_name text,quantity numeric,unit text,unit_cost numeric,inventory_item_id uuid
  );
 end if;
 return v_purchase_id;
end;
$$;
revoke all on function public.save_restaurant_purchase(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_restaurant_purchase(uuid,uuid,jsonb,jsonb) to authenticated;
