
-- Bite priced-options schema: additive only; customer paid-options checkout remains disabled.
-- Restaurant ownership is enforced twice: composite foreign keys and RLS.
alter table public.menu_items
  add constraint menu_items_restaurant_id_id_unique unique (restaurant_id,id);

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  min_select smallint not null default 0 check (min_select between 0 and 8),
  max_select smallint not null default 1 check (max_select between 1 and 8),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_option_group_limits check (min_select <= max_select),
  constraint menu_option_groups_restaurant_id_id_unique unique (restaurant_id,id)
);

create table public.menu_option_choices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  option_group_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  price_delta numeric(12,2) not null default 0 check (price_delta >= 0 and price_delta <= 10000),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_option_choices_group_tenant_fk foreign key (restaurant_id,option_group_id)
    references public.menu_option_groups (restaurant_id,id) on delete cascade
);

create table public.menu_item_option_groups (
  restaurant_id uuid not null,
  menu_item_id uuid not null,
  option_group_id uuid not null,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  constraint menu_item_option_groups_pk primary key (restaurant_id,menu_item_id,option_group_id),
  constraint menu_item_option_groups_item_tenant_fk foreign key (restaurant_id,menu_item_id)
    references public.menu_items (restaurant_id,id) on delete cascade,
  constraint menu_item_option_groups_group_tenant_fk foreign key (restaurant_id,option_group_id)
    references public.menu_option_groups (restaurant_id,id) on delete cascade
);

create index menu_option_groups_restaurant_idx on public.menu_option_groups (restaurant_id,is_available,sort_order);
create index menu_option_choices_group_idx on public.menu_option_choices (restaurant_id,option_group_id,is_available,sort_order);
create index menu_item_option_groups_group_idx on public.menu_item_option_groups (restaurant_id,option_group_id);

alter table public.menu_option_groups enable row level security;
alter table public.menu_option_choices enable row level security;
alter table public.menu_item_option_groups enable row level security;

-- No access is granted implicitly. Reads require published restaurant or membership;
-- writes require a verified owner/manager membership or platform-admin status.
revoke all on public.menu_option_groups, public.menu_option_choices, public.menu_item_option_groups
  from public, anon, authenticated;
grant select on public.menu_option_groups, public.menu_option_choices, public.menu_item_option_groups
  to anon, authenticated;
grant insert, update, delete on public.menu_option_groups, public.menu_option_choices, public.menu_item_option_groups
  to authenticated;

create policy "published groups are readable" on public.menu_option_groups
 for select to anon,authenticated
 using (is_available and public.is_restaurant_public(restaurant_id));
create policy "teams read all groups" on public.menu_option_groups
 for select to authenticated
 using (public.is_platform_admin() or public.is_restaurant_member(restaurant_id));
create policy "owners manage groups" on public.menu_option_groups
 for all to authenticated
 using (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']))
 with check (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']));

create policy "published choices are readable" on public.menu_option_choices
 for select to anon,authenticated
 using (is_available and public.is_restaurant_public(restaurant_id)
  and exists (select 1 from public.menu_option_groups g
    where g.restaurant_id=menu_option_choices.restaurant_id and g.id=menu_option_choices.option_group_id and g.is_available));
create policy "teams read all choices" on public.menu_option_choices
 for select to authenticated
 using (public.is_platform_admin() or public.is_restaurant_member(restaurant_id));
create policy "owners manage choices" on public.menu_option_choices
 for all to authenticated
 using (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']))
 with check (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']));

create policy "published mappings are readable" on public.menu_item_option_groups
 for select to anon,authenticated
 using (is_available and public.is_restaurant_public(restaurant_id)
  and exists (select 1 from public.menu_items m
    where m.restaurant_id=menu_item_option_groups.restaurant_id and m.id=menu_item_option_groups.menu_item_id and m.is_available)
  and exists (select 1 from public.menu_option_groups g
    where g.restaurant_id=menu_item_option_groups.restaurant_id and g.id=menu_item_option_groups.option_group_id and g.is_available));
create policy "teams read all mappings" on public.menu_item_option_groups
 for select to authenticated
 using (public.is_platform_admin() or public.is_restaurant_member(restaurant_id));
create policy "owners manage mappings" on public.menu_item_option_groups
 for all to authenticated
 using (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']))
 with check (public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner','manager']));
