-- Consolidated reference snapshot for RestaurantOS inventory and stock ledger.
-- Live migration history: 20261106155919, 20261106155927, 20261106155949, 20261106160036.
-- This documents the final applied schema; the live Supabase migration history is authoritative.

create table if not exists public.restaurant_inventory_items (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 160),
 category text,
 unit text not null default 'pcs' check(length(btrim(unit)) between 1 and 24),
 reorder_level numeric(14,3) not null default 0 check(reorder_level>=0),
 notes text,
 is_active boolean not null default true,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists restaurant_inventory_items_name_unique on public.restaurant_inventory_items(restaurant_id,lower(name));
create index if not exists restaurant_inventory_items_restaurant_idx on public.restaurant_inventory_items(restaurant_id,is_active,name);
create index if not exists restaurant_inventory_items_created_by_idx on public.restaurant_inventory_items(created_by);
alter table public.restaurant_inventory_items enable row level security;
create policy "Inventory members read" on public.restaurant_inventory_items for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Inventory managers insert" on public.restaurant_inventory_items for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()));
create policy "Inventory managers update" on public.restaurant_inventory_items for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Inventory owners delete" on public.restaurant_inventory_items for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());

create table if not exists public.restaurant_stock_movements (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 inventory_item_id uuid not null references public.restaurant_inventory_items(id) on delete restrict,
 movement_type text not null check(movement_type in ('opening','purchase','adjustment_in','adjustment_out','wastage')),
 quantity numeric(14,3) not null check(quantity>0),
 unit_cost numeric(14,2) check(unit_cost is null or unit_cost>=0),
 movement_date date not null default current_date,
 expiry_date date,
 reference text,
 notes text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists restaurant_stock_movements_item_date_idx on public.restaurant_stock_movements(inventory_item_id,movement_date desc);
create index if not exists restaurant_stock_movements_restaurant_date_idx on public.restaurant_stock_movements(restaurant_id,movement_date desc);
create index if not exists restaurant_stock_movements_created_by_idx on public.restaurant_stock_movements(created_by);
alter table public.restaurant_stock_movements enable row level security;
create policy "Stock movements members read" on public.restaurant_stock_movements for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Stock movements managers insert" on public.restaurant_stock_movements for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()) and exists(select 1 from public.restaurant_inventory_items i where i.id=inventory_item_id and i.restaurant_id=restaurant_id));

create or replace function public.set_inventory_item_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end; $$;
create trigger restaurant_inventory_items_updated_at before update on public.restaurant_inventory_items for each row execute function public.set_inventory_item_updated_at();
create or replace function public.guard_inventory_item_identity() returns trigger language plpgsql set search_path='' as $$
begin if tg_op='UPDATE' and (new.restaurant_id is distinct from old.restaurant_id or new.created_by is distinct from old.created_by) then raise exception 'Inventory item ownership fields are immutable'; end if; return new; end; $$;
create trigger restaurant_inventory_items_guard_identity before update on public.restaurant_inventory_items for each row execute function public.guard_inventory_item_identity();

create or replace function public.guard_restaurant_stock_movement() returns trigger language plpgsql set search_path='' as $$
declare current_qty numeric(14,3); delta_qty numeric(14,3);
begin
 perform 1 from public.restaurant_inventory_items i where i.id=new.inventory_item_id and i.restaurant_id=new.restaurant_id and i.is_active for update;
 if not found then raise exception 'Inventory item must be active and belong to the same restaurant'; end if;
 select coalesce(sum(case when movement_type in ('opening','purchase','adjustment_in') then quantity else -quantity end),0) into current_qty from public.restaurant_stock_movements where inventory_item_id=new.inventory_item_id;
 delta_qty:=case when new.movement_type in ('opening','purchase','adjustment_in') then new.quantity else -new.quantity end;
 if current_qty+delta_qty<0 then raise exception 'Stock cannot become negative'; end if;
 return new;
end; $$;
create trigger restaurant_stock_movements_guard before insert on public.restaurant_stock_movements for each row execute function public.guard_restaurant_stock_movement();

create or replace view public.restaurant_inventory_balances with (security_invoker=true) as
select i.id as inventory_item_id,i.restaurant_id,
 coalesce(sum(case when m.movement_type in ('opening','purchase','adjustment_in') then m.quantity else -m.quantity end),0)::numeric(14,3) as current_stock
from public.restaurant_inventory_items i
left join public.restaurant_stock_movements m on m.inventory_item_id=i.id and m.restaurant_id=i.restaurant_id
where i.is_active group by i.id,i.restaurant_id;
grant select on public.restaurant_inventory_balances to authenticated;

-- Stock movements are immutable; corrections should be recorded as new adjustment movements.
revoke update,delete on public.restaurant_stock_movements from authenticated,anon;
