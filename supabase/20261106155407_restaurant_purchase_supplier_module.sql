-- RestaurantOS purchase and supplier module (applied 2026-11-06)
create table if not exists public.restaurant_suppliers (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 120), phone text, address text, notes text,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists restaurant_suppliers_restaurant_name_idx on public.restaurant_suppliers(restaurant_id,name);
alter table public.restaurant_suppliers enable row level security;
create policy "Supplier members read" on public.restaurant_suppliers for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Supplier managers write" on public.restaurant_suppliers for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()));
create policy "Supplier managers update" on public.restaurant_suppliers for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Supplier owners delete" on public.restaurant_suppliers for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());
create or replace function public.set_restaurant_supplier_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end; $$;
create trigger restaurant_suppliers_updated_at before update on public.restaurant_suppliers for each row execute function public.set_restaurant_supplier_updated_at();

create table if not exists public.restaurant_purchases (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 supplier_id uuid references public.restaurant_suppliers(id) on delete set null, supplier_name_snapshot text,
 purchase_date date not null default current_date, invoice_number text,
 total_amount numeric(14,2) not null default 0 check(total_amount>=0),
 paid_amount numeric(14,2) not null default 0 check(paid_amount>=0 and paid_amount<=total_amount),
 payment_method text not null default 'Unpaid' check(payment_method in ('Unpaid','Cash','UPI','Card','Bank Transfer','Other')),
 notes text, created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(supplier_id is not null or length(btrim(coalesce(supplier_name_snapshot,'')))>0)
);
create index if not exists restaurant_purchases_restaurant_date_idx on public.restaurant_purchases(restaurant_id,purchase_date desc);
create index if not exists restaurant_purchases_supplier_idx on public.restaurant_purchases(supplier_id);
alter table public.restaurant_purchases enable row level security;
create policy "Purchases members read" on public.restaurant_purchases for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Purchases managers insert" on public.restaurant_purchases for insert to authenticated with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) and created_by=(select auth.uid()));
create policy "Purchases managers update" on public.restaurant_purchases for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Purchases owners delete" on public.restaurant_purchases for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());
create trigger restaurant_purchases_updated_at before update on public.restaurant_purchases for each row execute function public.set_restaurant_supplier_updated_at();

create table if not exists public.restaurant_purchase_items (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.restaurant_purchases(id) on delete cascade,
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 item_name text not null check(length(btrim(item_name)) between 1 and 160), quantity numeric(14,3) not null check(quantity>0),
 unit text not null default 'pcs' check(length(btrim(unit)) between 1 and 24), unit_cost numeric(14,2) not null check(unit_cost>=0),
 line_total numeric(14,2) generated always as(round(quantity*unit_cost,2)) stored, created_at timestamptz not null default now()
);
create index if not exists restaurant_purchase_items_purchase_idx on public.restaurant_purchase_items(purchase_id);
create index if not exists restaurant_purchase_items_restaurant_idx on public.restaurant_purchase_items(restaurant_id);
alter table public.restaurant_purchase_items enable row level security;
create policy "Purchase items members read" on public.restaurant_purchase_items for select to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin());
create policy "Purchase items managers insert" on public.restaurant_purchase_items for insert to authenticated with check((public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) and exists(select 1 from public.restaurant_purchases p where p.id=purchase_id and p.restaurant_id=restaurant_id));
create policy "Purchase items managers update" on public.restaurant_purchase_items for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) with check((public.has_restaurant_role(restaurant_id,array['owner','manager']) or public.is_platform_admin()) and exists(select 1 from public.restaurant_purchases p where p.id=purchase_id and p.restaurant_id=restaurant_id));
create policy "Purchase items owners delete" on public.restaurant_purchase_items for delete to authenticated using(public.has_restaurant_role(restaurant_id,array['owner']) or public.is_platform_admin());
