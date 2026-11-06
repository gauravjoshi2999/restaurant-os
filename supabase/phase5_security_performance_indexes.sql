-- RestaurantOS Phase 5: safe performance and RLS initialization improvements.
-- Adds missing FK indexes without dropping existing indexes or changing business data.
-- Rewrites auth.uid() policy checks to initplan form for one evaluation per statement.

create index if not exists menu_items_category_id_idx on public.menu_items(category_id);
create index if not exists order_delivery_locations_restaurant_id_idx on public.order_delivery_locations(restaurant_id);
create index if not exists order_delivery_locations_updated_by_idx on public.order_delivery_locations(updated_by);
create index if not exists order_financials_created_by_idx on public.order_financials(created_by);
create index if not exists order_status_history_changed_by_idx on public.order_status_history(changed_by);
create index if not exists order_status_history_restaurant_id_idx on public.order_status_history(restaurant_id);
create index if not exists orders_created_by_idx on public.orders(created_by);
create index if not exists platform_expenses_created_by_idx on public.platform_expenses(created_by);
create index if not exists restaurant_settlements_created_by_idx on public.restaurant_settlements(created_by);
create index if not exists restaurants_created_by_idx on public.restaurants(created_by);

drop policy if exists "profile read own" on public.profiles;
create policy "profile read own" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profile insert own" on public.profiles;
create policy "profile insert own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "members can create orders" on public.orders;
create policy "members can create orders" on public.orders for insert to authenticated with check (created_by = (select auth.uid()) and public.is_restaurant_member(restaurant_id));
