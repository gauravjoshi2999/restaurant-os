-- Staged launch completion. Do not apply to production before release approval.
-- Additive: historical orders and payment records are preserved.
create table public.bite_customer_controls (
 customer_id uuid primary key references auth.users(id) on delete cascade,
 suspended boolean not null default false, reason text, updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id), deletion_requested_at timestamptz,
 constraint suspension_reason check (not suspended or length(btrim(reason)) between 5 and 500)
);
create index bite_customer_controls_updated_by_idx on public.bite_customer_controls(updated_by);
alter table public.bite_customer_controls enable row level security;
create policy customer_control_read on public.bite_customer_controls for select to authenticated using(customer_id=(select auth.uid()) or public.is_platform_admin());
grant select on public.bite_customer_controls to authenticated;

create table public.bite_customer_favourites (
 customer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(customer_id,restaurant_id)
);
create index bite_favourites_restaurant_idx on public.bite_customer_favourites(restaurant_id);
alter table public.bite_customer_favourites enable row level security;
create policy own_favourites on public.bite_customer_favourites for all to authenticated
 using(customer_id=(select auth.uid())) with check(customer_id=(select auth.uid()) and public.is_restaurant_public(restaurant_id));
grant select,insert,delete on public.bite_customer_favourites to authenticated;

create table public.bite_storefront_categories (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 60),
 cuisine_tag text not null check(length(cuisine_tag) between 2 and 60),
 image_key text not null default 'meal' check(image_key in ('meal','curry','pizza','dosa','noodles','dessert','burger','fresh')),
 sort_order integer not null default 0, is_active boolean not null default true
);
insert into public.bite_storefront_categories(name,cuisine_tag,image_key,sort_order) values
 ('Thali & curries','North Indian','curry',1),('Pizza','Pizza','pizza',2),('South Indian','South Indian','dosa',3),
 ('Chinese','Chinese','noodles',4),('Something sweet','Desserts','dessert',5),('Burgers & bites','Fast Food','burger',6);
alter table public.bite_storefront_categories enable row level security;
create policy public_categories on public.bite_storefront_categories for select to anon,authenticated using(is_active or public.is_platform_admin());
create policy admin_categories on public.bite_storefront_categories for all to authenticated using(public.is_platform_admin()) with check(public.is_platform_admin());
grant select on public.bite_storefront_categories to anon,authenticated;
grant insert,update,delete on public.bite_storefront_categories to authenticated;
create table public.bite_featured_restaurants (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade, sort_order integer not null default 0,
 starts_at timestamptz not null default now(), ends_at timestamptz, check(ends_at is null or ends_at>starts_at)
);
alter table public.bite_featured_restaurants enable row level security;
create policy admin_featured on public.bite_featured_restaurants for all to authenticated using(public.is_platform_admin()) with check(public.is_platform_admin());
grant select,insert,update,delete on public.bite_featured_restaurants to authenticated;

create table public.bite_coupons (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid references public.restaurants(id) on delete restrict,
 code text not null unique check(code ~ '^[A-Z0-9]{3,24}$'), title text not null check(length(title) between 3 and 100),
 discount_type text not null check(discount_type in ('percent','fixed')), discount_value numeric(12,2) not null check(discount_value>0),
 max_discount numeric(12,2) check(max_discount>0), minimum_order numeric(12,2) not null default 0 check(minimum_order>=0),
 starts_at timestamptz not null default now(), ends_at timestamptz not null, is_active boolean not null default true,
 total_limit integer check(total_limit>0), per_customer_limit integer not null default 1 check(per_customer_limit between 1 and 100),
 terms text not null default '' check(length(terms)<=1000), created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), check(ends_at>starts_at),check(discount_type<>'percent' or discount_value<=100)
);
create index bite_coupons_restaurant_idx on public.bite_coupons(restaurant_id);
create index bite_coupons_created_by_idx on public.bite_coupons(created_by);
alter table public.bite_coupons enable row level security;
create policy coupons_read on public.bite_coupons for select to anon,authenticated using(
 (is_active and starts_at<=now() and ends_at>now() and (restaurant_id is null or public.is_restaurant_public(restaurant_id)))
 or public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner']));
-- Mutations go through a guarded RPC: an owner cannot move a coupon to another restaurant or platform funding.
grant select on public.bite_coupons to anon,authenticated;
alter table public.bite_live_checkout_intents add column coupon_id uuid references public.bite_coupons(id),
 add column coupon_code text,add column discount_amount numeric(12,2) not null default 0 check(discount_amount>=0),
 add column discount_sponsor text check(discount_sponsor in ('restaurant','platform')),
 add column checkout_key uuid, add column address_snapshot jsonb, add column customer_snapshot jsonb, add column commission_rate_snapshot numeric(8,2), add column provider_attempted_at timestamptz;
create index bite_intents_coupon_idx on public.bite_live_checkout_intents(coupon_id,customer_id,status);
create unique index bite_intents_checkout_key_idx on public.bite_live_checkout_intents(customer_id,checkout_key) where checkout_key is not null;
alter table public.order_items add column menu_item_id uuid references public.menu_items(id) on delete set null;
create index order_items_menu_item_idx on public.order_items(menu_item_id);
alter table public.order_financials add column coupon_code text;
alter table public.restaurant_expenses add column bill_path text;

create or replace function public.bite_assert_customer_can_order() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required';end if;
 if exists(select 1 from public.bite_customer_controls where customer_id=auth.uid() and (suspended or deletion_requested_at is not null)) then
 raise exception 'Account ordering is paused. Contact Bite support.' using errcode='42501';end if;
end $$;
revoke all on function public.bite_assert_customer_can_order() from public,anon;
grant execute on function public.bite_assert_customer_can_order() to authenticated;
create or replace function public.bite_guard_checkout_customer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.bite_customer_controls where customer_id=new.customer_id and (suspended or deletion_requested_at is not null)) then raise exception 'Account ordering is paused. Contact Bite support.';end if;
 return new;
end $$;
revoke all on function public.bite_guard_checkout_customer() from public,anon,authenticated;
create trigger bite_guard_checkout_customer before insert on public.bite_live_checkout_intents for each row execute function public.bite_guard_checkout_customer();
create trigger bite_guard_sandbox_customer before insert on public.bite_sandbox_order_drafts for each row execute function public.bite_guard_checkout_customer();

create or replace function public.bite_save_coupon(p_id uuid,p_restaurant_id uuid,p_coupon jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_old public.bite_coupons%rowtype;
begin
 if auth.uid() is null or not (public.is_platform_admin() or (p_restaurant_id is not null and public.has_restaurant_role(p_restaurant_id,array['owner']))) then raise exception 'Coupon management denied' using errcode='42501';end if;
 if p_id is not null then
 select * into v_old from public.bite_coupons where id=p_id for update;
 if not found or v_old.restaurant_id is distinct from p_restaurant_id then raise exception 'Coupon scope cannot change';end if;
 if exists(select 1 from public.bite_live_checkout_intents where coupon_id=p_id and status not in ('failed','expired')) then
 -- Honour every issued payment snapshot. Used coupons can be paused, never silently repriced.
 if (p_coupon - 'is_active') <> (to_jsonb(v_old)-array['id','restaurant_id','created_at','created_by','is_active']) then
 raise exception 'This coupon has checkout history. Create a new code to change its terms.';end if;
 update public.bite_coupons set is_active=coalesce((p_coupon->>'is_active')::boolean,false) where id=p_id;
 return p_id;
 end if;
 end if;
 insert into public.bite_coupons(id,restaurant_id,code,title,discount_type,discount_value,max_discount,minimum_order,starts_at,ends_at,is_active,total_limit,per_customer_limit,terms)
 values(coalesce(p_id,gen_random_uuid()),p_restaurant_id,upper(btrim(p_coupon->>'code')),btrim(p_coupon->>'title'),p_coupon->>'discount_type',(p_coupon->>'discount_value')::numeric,nullif(p_coupon->>'max_discount','')::numeric,coalesce((p_coupon->>'minimum_order')::numeric,0),coalesce((p_coupon->>'starts_at')::timestamptz,now()),(p_coupon->>'ends_at')::timestamptz,coalesce((p_coupon->>'is_active')::boolean,true),nullif(p_coupon->>'total_limit','')::integer,coalesce((p_coupon->>'per_customer_limit')::integer,1),coalesce(p_coupon->>'terms',''))
 on conflict(id) do update set code=excluded.code,title=excluded.title,discount_type=excluded.discount_type,discount_value=excluded.discount_value,max_discount=excluded.max_discount,minimum_order=excluded.minimum_order,starts_at=excluded.starts_at,ends_at=excluded.ends_at,is_active=excluded.is_active,total_limit=excluded.total_limit,per_customer_limit=excluded.per_customer_limit,terms=excluded.terms returning id into v_id;
 return v_id;
end $$;
revoke all on function public.bite_save_coupon(uuid,uuid,jsonb) from public,anon;
grant execute on function public.bite_save_coupon(uuid,uuid,jsonb) to authenticated;
create or replace function public.bite_pause_coupon(p_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.bite_coupons%rowtype;
begin
 select * into c from public.bite_coupons where id=p_id for update;
 if not found or auth.uid() is null or not(public.is_platform_admin() or public.has_restaurant_role(c.restaurant_id,array['owner'])) then raise exception 'Coupon management denied';end if;
 update public.bite_coupons set is_active=p_active where id=p_id;
end $$;
revoke all on function public.bite_pause_coupon(uuid,boolean) from public,anon;
grant execute on function public.bite_pause_coupon(uuid,boolean) to authenticated;

create or replace function public.bite_coupon_quote(p_restaurant_id uuid,p_code text,p_food_subtotal numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.bite_coupons%rowtype;v_discount numeric;v_count integer;
begin
 perform public.bite_assert_customer_can_order();
 if p_food_subtotal is null or p_food_subtotal<=0 or p_food_subtotal>1000000 then raise exception 'Invalid subtotal';end if;
 select * into c from public.bite_coupons where code=upper(btrim(p_code)) and (restaurant_id=p_restaurant_id or restaurant_id is null) and is_active and starts_at<=now() and ends_at>now();
 if not found or not public.is_restaurant_public(p_restaurant_id) then raise exception 'Coupon unavailable or expired';end if;
 if p_food_subtotal<c.minimum_order then raise exception 'Coupon minimum food order is %',c.minimum_order;end if;
 -- Reservations remain counted until the provider confirms EXPIRED/TERMINATED, not a browser timeout.
 select count(*) into v_count from public.bite_live_checkout_intents where coupon_id=c.id and status not in ('failed','expired') and customer_id=auth.uid();
 if v_count>=c.per_customer_limit then raise exception 'Coupon already used or reserved in a pending payment';end if;
 if c.total_limit is not null and (select count(*) from public.bite_live_checkout_intents where coupon_id=c.id and status not in ('failed','expired'))>=c.total_limit then raise exception 'Coupon usage limit reached';end if;
 v_discount:=least(p_food_subtotal,coalesce(c.max_discount,p_food_subtotal),case when c.discount_type='percent' then round(p_food_subtotal*c.discount_value/100,2) else c.discount_value end);
 return jsonb_build_object('id',c.id,'code',c.code,'discount_amount',v_discount,'sponsor',case when c.restaurant_id is null then 'platform' else 'restaurant' end,'terms',c.terms);
end $$;
revoke all on function public.bite_coupon_quote(uuid,text,numeric) from public,anon;
grant execute on function public.bite_coupon_quote(uuid,text,numeric) to authenticated;

create or replace function public.bite_prepare_checkout_v2(p_restaurant_id uuid,p_delivery_type text,p_address_id uuid,p_customer_note text,p_items jsonb,p_coupon_code text default null,p_checkout_key uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_coupon uuid;v_quote jsonb;v_subtotal numeric;v_discount numeric;
begin
 perform public.bite_assert_customer_can_order();
 if p_checkout_key is null then raise exception 'Checkout request key required';end if;
 if not exists(select 1 from public.customer_contact_profiles where customer_id=auth.uid() and length(btrim(full_name)) between 2 and 80 and phone ~ '^[0-9]{10,15}$') then raise exception 'Valid customer name and phone required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_checkout_key::text,0));
 select id into v_id from public.bite_live_checkout_intents where customer_id=auth.uid() and checkout_key=p_checkout_key;
 if found then
 if not exists(select 1 from public.bite_live_checkout_intents i where i.id=v_id and i.restaurant_id=p_restaurant_id and i.delivery_type=p_delivery_type and i.address_id is not distinct from (case when p_delivery_type='delivery' then p_address_id else null end) and i.items=p_items and coalesce(i.coupon_code,'')=upper(btrim(coalesce(p_coupon_code,'')))) then raise exception 'Checkout key already belongs to a different cart';end if;
 return v_id;end if;
 if nullif(btrim(p_coupon_code),'') is not null then
 select id into v_coupon from public.bite_coupons where code=upper(btrim(p_coupon_code));
 if v_coupon is null then raise exception 'Coupon unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_coupon::text,0));
 end if;
 v_id:=public.bite_prepare_live_checkout(p_restaurant_id,p_delivery_type,p_address_id,p_customer_note,p_items);
 if v_coupon is not null then
 select food_subtotal into v_subtotal from public.bite_live_checkout_intents where id=v_id;
 v_quote:=public.bite_coupon_quote(p_restaurant_id,p_coupon_code,v_subtotal);v_discount:=(v_quote->>'discount_amount')::numeric;
 update public.bite_live_checkout_intents set coupon_id=v_coupon,coupon_code=v_quote->>'code',discount_amount=v_discount,discount_sponsor=v_quote->>'sponsor',amount=amount-v_discount where id=v_id;
 end if;
 update public.bite_live_checkout_intents set checkout_key=p_checkout_key,
 address_snapshot=(select to_jsonb(a) from public.customer_addresses a where a.id=p_address_id and a.customer_id=auth.uid()),
 customer_snapshot=(select jsonb_build_object('full_name',p.full_name,'phone',p.phone) from public.customer_contact_profiles p where p.customer_id=auth.uid()),commission_rate_snapshot=coalesce((select platform_commission_rate from public.restaurants where id=p_restaurant_id),(select default_commission_rate from public.platform_settings limit 1),10) where id=v_id;
 if (select amount<1 from public.bite_live_checkout_intents where id=v_id) then raise exception 'Online payment total must be at least 1 rupee';end if;
 return v_id;
end $$;
revoke all on function public.bite_prepare_checkout_v2(uuid,text,uuid,text,jsonb,text,uuid) from public,anon;
grant execute on function public.bite_prepare_checkout_v2(uuid,text,uuid,text,jsonb,text,uuid) to authenticated;

create or replace function public.bite_storefront(p_postal_code text default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('restaurants',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'serviceable',case when p_postal_code is null then null else exists(select 1 from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id where zp.restaurant_id=r.id and zp.postal_code=p_postal_code and z.is_active) end,
 'zone_delivery_fee',(select min(z.delivery_fee) from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id where zp.restaurant_id=r.id and zp.postal_code=p_postal_code and z.is_active),
 'price_from',(select min(m.price) from public.menu_items m where m.restaurant_id=r.id and m.is_available),
 'has_veg',exists(select 1 from public.menu_items m where m.restaurant_id=r.id and m.is_available and m.is_vegetarian),
 'has_nonveg',exists(select 1 from public.menu_items m where m.restaurant_id=r.id and m.is_available and not m.is_vegetarian),
 'featured',exists(select 1 from public.bite_featured_restaurants f where f.restaurant_id=r.id and f.starts_at<=now() and (f.ends_at is null or f.ends_at>now()))
 )) from public.list_public_restaurants() r),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.name) from public.bite_storefront_categories c where c.is_active),'[]'::jsonb));
$$;
revoke all on function public.bite_storefront(text) from public;
grant execute on function public.bite_storefront(text) to anon,authenticated;

create or replace function public.bite_reorder_items(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
 select * into o from public.orders where id=p_order_id and customer_id=auth.uid();
 if not found then raise exception 'Order not found';end if;
 if not public.is_restaurant_public(o.restaurant_id) then raise exception 'Restaurant is currently unavailable';end if;
 return jsonb_build_object('restaurant_id',o.restaurant_id,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.item_name,'quantity',i.quantity,'menu_item_id',m.id,'price',m.price,'available',coalesce(m.is_available,false))),'[]'::jsonb) from public.order_items i left join lateral(select mi.id,mi.price,mi.is_available from public.menu_items mi where mi.restaurant_id=o.restaurant_id and (mi.id=i.menu_item_id or (i.menu_item_id is null and mi.name=i.item_name and (select count(*) from public.menu_items x where x.restaurant_id=o.restaurant_id and x.name=i.item_name)=1)) limit 1)m on true where i.order_id=o.id));
end $$;
revoke all on function public.bite_reorder_items(uuid) from public,anon;
grant execute on function public.bite_reorder_items(uuid) to authenticated;

create or replace function public.bite_customer_invoice(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.orders%rowtype;r public.restaurants%rowtype;f public.order_financials%rowtype;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or auth.uid() is null or not (o.customer_id is not distinct from auth.uid() or public.has_restaurant_role(o.restaurant_id,array['owner']) or public.is_platform_admin()) then raise exception 'Invoice access denied' using errcode='42501';end if;
 select * into r from public.restaurants where id=o.restaurant_id;select * into f from public.order_financials where order_id=o.id;
 return jsonb_build_object('order_code',o.order_code,'date',o.order_date,'restaurant',r.name,'restaurant_address',r.address,'phone',r.phone,'customer',o.customer_name,'status',o.status,'is_demo',o.is_demo,'delivery_type',o.delivery_type,'payment_status',coalesce(f.payment_status,'unpaid'),'subtotal',coalesce(f.food_subtotal,(select sum(line_total) from public.order_items where order_id=o.id)), 'delivery_fee',coalesce(f.delivery_fee,0),'discount',coalesce(f.restaurant_discount,0)+coalesce(f.platform_discount,0),'tax',coalesce(f.tax_amount,0),'total',o.amount,'refund',coalesce(f.refund_amount_actual,0),'coupon_code',f.coupon_code,'items',coalesce((select jsonb_agg(jsonb_build_object('name',item_name,'quantity',quantity,'price',unit_price,'total',line_total) order by created_at) from public.order_items where order_id=o.id),'[]'::jsonb),'document_type','Order receipt');
end $$;
revoke all on function public.bite_customer_invoice(uuid) from public,anon;
grant execute on function public.bite_customer_invoice(uuid) to authenticated;

create or replace function public.bite_admin_customers(p_search text default '',p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_platform_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(c)) from(select u.id,u.email,p.full_name,p.phone,u.created_at,coalesce(cc.suspended,false) suspended,cc.reason,cc.deletion_requested_at,(select count(*) from public.orders o where o.customer_id=u.id and not o.is_demo) order_count from auth.users u left join public.customer_contact_profiles p on p.customer_id=u.id left join public.bite_customer_controls cc on cc.customer_id=u.id where not exists(select 1 from public.restaurant_members m where m.user_id=u.id) and not exists(select 1 from public.platform_admins a where a.user_id=u.id) and (coalesce(p.full_name,'')||' '||coalesce(p.phone,'')||' '||coalesce(u.email,'')) ilike '%'||left(coalesce(p_search,''),100)||'%' order by u.created_at desc limit 50 offset greatest(0,least(coalesce(p_offset,0),100000)))c),'[]'::jsonb);
end $$;
revoke all on function public.bite_admin_customers(text,integer) from public,anon;
grant execute on function public.bite_admin_customers(text,integer) to authenticated;
create or replace function public.bite_admin_set_customer_status(p_customer_id uuid,p_suspended boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Reason must be 5 to 500 characters';end if;
 if exists(select 1 from public.restaurant_members where user_id=p_customer_id) or exists(select 1 from public.platform_admins where user_id=p_customer_id) then raise exception 'Use the appropriate restaurant or Admin account control';end if;
 insert into public.bite_customer_controls(customer_id,suspended,reason,updated_by) values(p_customer_id,p_suspended,btrim(p_reason),auth.uid()) on conflict(customer_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
end $$;
revoke all on function public.bite_admin_set_customer_status(uuid,boolean,text) from public,anon;
grant execute on function public.bite_admin_set_customer_status(uuid,boolean,text) to authenticated;
create or replace function public.bite_request_account_deletion() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required';end if;
 if exists(select 1 from public.restaurant_members where user_id=auth.uid()) or public.is_platform_admin() then raise exception 'Business accounts must contact support';end if;
 insert into public.bite_customer_controls(customer_id,deletion_requested_at) values(auth.uid(),now()) on conflict(customer_id) do update set deletion_requested_at=coalesce(public.bite_customer_controls.deletion_requested_at,now()),updated_at=now();
end $$;
revoke all on function public.bite_request_account_deletion() from public,anon;
grant execute on function public.bite_request_account_deletion() to authenticated;

CREATE OR REPLACE FUNCTION public.bite_finalize_verified_live_checkout(p_intent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.bite_live_checkout_intents%rowtype; v_order uuid; v_item jsonb; v_menu public.menu_items%rowtype; v_profile public.customer_contact_profiles%rowtype; v_address jsonb; v_rate numeric(8,2); v_code text;v_snapshot_total numeric(12,2):=0;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found then raise exception 'Intent missing';end if;
 if v.status='activated' then return v.activated_order_id;end if;
 if v.status<>'payment_verified' or v.provider_order_id is null then raise exception 'Verified payment required';end if;
 if v.delivery_type not in ('pickup','delivery') or v.priced_items is null or jsonb_typeof(v.priced_items)<>'array' or jsonb_array_length(v.priced_items) not between 1 and 50 then raise exception 'Invalid checkout snapshot';end if;
 if v.food_subtotal is null or v.delivery_fee is null or v.food_subtotal+v.delivery_fee-v.discount_amount<>v.amount or v.discount_amount>v.food_subtotal then raise exception 'Checkout totals inconsistent';end if;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop
 if (v_item->>'quantity') !~ '^[0-9]{1,2}$' or (v_item->>'unit_price') !~ '^[0-9]+([.][0-9]{1,2})?$' or nullif(v_item->>'item_name','') is null then raise exception 'Invalid priced snapshot';end if;
 v_snapshot_total:=v_snapshot_total+round((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric,2);
 end loop;
 if v_snapshot_total<>v.food_subtotal then raise exception 'Snapshot total mismatch';end if;
 select * into v_profile from public.customer_contact_profiles where customer_id=v.customer_id;
 if v.customer_snapshot is not null then v_profile.full_name:=v.customer_snapshot->>'full_name';v_profile.phone:=v.customer_snapshot->>'phone';end if;
 if v.delivery_type='delivery' then
 v_address:=v.address_snapshot;
 if v_address is null then select to_jsonb(a) into v_address from public.customer_addresses a where a.id=v.address_id and a.customer_id=v.customer_id;end if;
 if v_address is null then raise exception 'Delivery address missing';end if;
 end if;
 select coalesce(v.commission_rate_snapshot,(select r.platform_commission_rate from public.restaurants r where r.id=v.restaurant_id),(select ps.default_commission_rate from public.platform_settings ps limit 1),10) into v_rate;
 if v_rate is null or v_rate<0 or v_rate>100 then raise exception 'Invalid commission rate';end if;
 v_code:='BITE-'||upper(substr(replace(v.id::text,'-',''),1,12));
 perform set_config('app.verified_checkout_activation','true',true);
 insert into public.orders(restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,customer_phone,delivery_type,delivery_address_snapshot,customer_note,is_demo)
 values(v.restaurant_id,v_code,'Own Platform',v.amount,'Received',v.customer_id,v.customer_id,coalesce(nullif(v_profile.full_name,''),'Customer'),v_profile.phone,v.delivery_type,v_address,v.customer_note,false) returning id into v_order;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop

 insert into public.order_items(order_id,item_name,quantity,unit_price,menu_item_id)
 values(v_order,v_item->>'item_name',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,(select m.id from public.menu_items m where m.id=(v_item->>'menu_item_id')::uuid and m.restaurant_id=v.restaurant_id));
 end loop;
 if (select coalesce(sum(line_total),0) from public.order_items where order_id=v_order)<>v.food_subtotal then raise exception 'Menu prices changed; manual reconciliation required';end if;
 insert into public.order_financials(order_id,restaurant_id,channel,food_subtotal,restaurant_discount,platform_discount,coupon_code,commissionable_food_value,commission_rate,commission_amount,delivery_fee,customer_payable_amount,payment_status,created_by,is_demo)
 values(v_order,v.restaurant_id,'Own Platform',v.food_subtotal,case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,case when v.discount_sponsor='platform' then v.discount_amount else 0 end,v.coupon_code,v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,v_rate,round((v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end)*v_rate/100,2),v.delivery_fee,v.amount,'paid',v.customer_id,false);
 update public.bite_live_checkout_intents set status='activated',activated_order_id=v_order,updated_at=now() where id=p_intent_id;
 return v_order;
end $function$;



revoke all on function public.bite_finalize_verified_live_checkout(uuid) from public,anon,authenticated;
grant execute on function public.bite_finalize_verified_live_checkout(uuid) to service_role;

-- Operational evidence is kept separate from collection, bank settlement and payouts.
create table public.bite_operation_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
 action text not null, entity_id uuid, detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create index bite_operation_audit_actor_idx on public.bite_operation_audit(actor_id);
alter table public.bite_operation_audit enable row level security;
create policy admin_operation_audit on public.bite_operation_audit for select to authenticated using(public.is_platform_admin());
grant select on public.bite_operation_audit to authenticated;
create or replace function public.bite_audit_control_change() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.bite_operation_audit(actor_id,action,entity_id,detail) values(auth.uid(),tg_table_name||':'||tg_op,coalesce((row_data->>'id')::uuid,(row_data->>'customer_id')::uuid,(row_data->>'restaurant_id')::uuid),jsonb_build_object('table',tg_table_name,'before',case when tg_op='INSERT' then null else to_jsonb(old) end,'after',case when tg_op='DELETE' then null else to_jsonb(new) end));
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.bite_audit_control_change() from public,anon,authenticated;
create trigger bite_audit_customers after insert or update on public.bite_customer_controls for each row execute function public.bite_audit_control_change();
create trigger bite_audit_coupons after insert or update on public.bite_coupons for each row execute function public.bite_audit_control_change();
create trigger bite_audit_categories after insert or update on public.bite_storefront_categories for each row execute function public.bite_audit_control_change();
create trigger bite_audit_featured after insert or update or delete on public.bite_featured_restaurants for each row execute function public.bite_audit_control_change();

create table public.bite_provider_checks (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 restaurant_id uuid not null references public.restaurants(id),customer_id uuid references auth.users(id),
 provider_order_id text not null,collection_status text not null,collection_amount numeric(12,2),
 settlement_evidence jsonb,checked_at timestamptz not null default now(),checked_by uuid references auth.users(id)
);
create index bite_provider_checks_order_idx on public.bite_provider_checks(order_id,checked_at desc);
create index bite_provider_checks_restaurant_idx on public.bite_provider_checks(restaurant_id);
create index bite_provider_checks_customer_idx on public.bite_provider_checks(customer_id);
create index bite_provider_checks_checked_by_idx on public.bite_provider_checks(checked_by);
alter table public.bite_provider_checks enable row level security;
-- Settlement references are business-private. Customers receive their collection/refund status via receipt/order APIs.
create policy business_provider_checks on public.bite_provider_checks for select to authenticated using(public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner']));
grant select on public.bite_provider_checks to authenticated;
grant all on public.bite_provider_checks to service_role;
create table public.bite_refund_jobs (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),
 restaurant_id uuid not null references public.restaurants(id),customer_id uuid references auth.users(id),
 amount numeric(12,2) not null check(amount>0 and amount::text not in ('NaN','Infinity','-Infinity')),
 reason text not null,status text not null default 'pending_approval' check(status in ('pending_approval','approved','processing','submitted','succeeded','failed','rejected')),
 provider_refund_id text not null unique,provider_status text,approved_by uuid references auth.users(id),approved_at timestamptz,
 provider_checked_at timestamptz,attempts integer not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index bite_refund_jobs_restaurant_idx on public.bite_refund_jobs(restaurant_id);
create index bite_refund_jobs_customer_idx on public.bite_refund_jobs(customer_id);
create index bite_refund_jobs_approver_idx on public.bite_refund_jobs(approved_by);
alter table public.bite_refund_jobs enable row level security;
create policy scoped_refund_status on public.bite_refund_jobs for select to authenticated using(public.is_platform_admin() or customer_id=(select auth.uid()) or public.has_restaurant_role(restaurant_id,array['owner']));
grant select on public.bite_refund_jobs to authenticated;
grant all on public.bite_refund_jobs to service_role;
create trigger bite_audit_refund_jobs after insert or update on public.bite_refund_jobs for each row execute function public.bite_audit_control_change();

create or replace function public.bite_queue_cancelled_refund() returns trigger language plpgsql security definer set search_path='' as $$
declare f public.order_financials%rowtype;v_id uuid:=gen_random_uuid();
begin
 if new.status in ('Cancelled','Rejected') and old.status not in ('Cancelled','Rejected') and not new.is_demo and new.channel='Own Platform' then
 select * into f from public.order_financials where order_id=new.id;
 if found and f.payment_status='paid' and f.refund_amount_actual=0 then
 insert into public.bite_refund_jobs(id,order_id,restaurant_id,customer_id,amount,reason,provider_refund_id)
 values(v_id,new.id,new.restaurant_id,new.customer_id,f.customer_payable_amount,coalesce(new.status_note,'Order cancelled or rejected'),'bite_rf_'||replace(v_id::text,'-','')) on conflict(order_id) do nothing;
 end if;
 end if;return new;
end $$;
revoke all on function public.bite_queue_cancelled_refund() from public,anon,authenticated;
create trigger bite_queue_cancelled_refund after update of status on public.orders for each row execute function public.bite_queue_cancelled_refund();
create or replace function public.bite_admin_refund_decision(p_job_id uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_admin() then raise exception 'Admin access required';end if;
 if length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Decision note required';end if;
 update public.bite_refund_jobs set status=case when p_approve then 'approved' else 'rejected' end,approved_by=auth.uid(),approved_at=now(),last_error=left(p_note,500),updated_at=now() where id=p_job_id and status='pending_approval';
 if not found then raise exception 'Refund is no longer pending approval';end if;
end $$;
revoke all on function public.bite_admin_refund_decision(uuid,boolean,text) from public,anon;
grant execute on function public.bite_admin_refund_decision(uuid,boolean,text) to authenticated;

-- No schedule is enabled by this migration. Explicit rollout time excludes historical orders.
create table public.bite_operations_config (
 id boolean primary key default true check(id), acceptance_timeout_enabled_since timestamptz,
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id),last_maintenance_at timestamptz
);
insert into public.bite_operations_config(id) values(true);
create index bite_operations_config_actor_idx on public.bite_operations_config(updated_by);
alter table public.bite_operations_config enable row level security;
create policy admin_ops_config on public.bite_operations_config for select to authenticated using(public.is_platform_admin());
grant select on public.bite_operations_config to authenticated;
create or replace function public.bite_admin_set_acceptance_timeout(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_admin() then raise exception 'Admin access required';end if;
 if p_enabled and not exists(select 1 from public.bite_operations_config where last_maintenance_at>now()-interval '3 minutes') then raise exception 'Connect the scheduled maintenance runner before enabling acceptance deadlines';end if;
 update public.bite_operations_config set acceptance_timeout_enabled_since=case when p_enabled then coalesce(acceptance_timeout_enabled_since,now()) else null end,updated_at=now(),updated_by=auth.uid() where id;
 insert into public.bite_operation_audit(actor_id,action,detail) values(auth.uid(),'acceptance_timeout',jsonb_build_object('enabled',p_enabled));
end $$;
revoke all on function public.bite_admin_set_acceptance_timeout(boolean) from public,anon;
grant execute on function public.bite_admin_set_acceptance_timeout(boolean) to authenticated;
create or replace function public.bite_cancel_unanswered_orders() returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;v_since timestamptz;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service only';end if;
 select acceptance_timeout_enabled_since into v_since from public.bite_operations_config where id;
 if v_since is null then return 0;end if;
 with expired as(select o.id from public.orders o join public.order_financials f on f.order_id=o.id where o.status='Received' and o.order_date<now()-interval '5 minutes' and o.order_date>=v_since and o.channel='Own Platform' and not o.is_demo and f.payment_status='paid' order by o.order_date for update of o skip locked limit 100)
 update public.orders o set status='Cancelled',status_note='Restaurant did not respond within 5 minutes; refund requires provider confirmation' from expired x where o.id=x.id and o.status='Received';
 get diagnostics v_count=row_count;return v_count;
end $$;
revoke all on function public.bite_cancel_unanswered_orders() from public,anon,authenticated;
grant execute on function public.bite_cancel_unanswered_orders() to service_role;

create table public.bite_restaurant_documents (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 kind text not null check(kind in ('fssai','business','bank','other')),storage_path text not null unique,
 original_name text not null check(length(original_name)<=160),uploaded_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), check(storage_path like restaurant_id::text||'/%')
);
create index bite_restaurant_documents_restaurant_idx on public.bite_restaurant_documents(restaurant_id);
create index bite_restaurant_documents_user_idx on public.bite_restaurant_documents(uploaded_by);
alter table public.bite_restaurant_documents enable row level security;
create policy business_documents_read on public.bite_restaurant_documents for select to authenticated using(public.is_platform_admin() or public.has_restaurant_role(restaurant_id,array['owner']));
create policy business_documents_insert on public.bite_restaurant_documents for insert to authenticated with check(uploaded_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']));
grant select,insert on public.bite_restaurant_documents to authenticated;
-- Buckets are provisioned via the Storage API by bite-assets (Admin only), not by changing storage metadata.
create policy bite_assets_read on storage.objects for select to authenticated using(bucket_id in ('bite-menu','bite-private') and (public.is_platform_admin() or public.has_restaurant_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end,array['owner'])));
create policy bite_assets_insert on storage.objects for insert to authenticated with check(bucket_id in ('bite-menu','bite-private') and public.has_restaurant_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end,array['owner']));
-- Immutable UUID object names: replacement uploads use a new object; no broad UPDATE/upsert policy.
create policy bite_assets_delete on storage.objects for delete to authenticated using(bucket_id in ('bite-menu','bite-private') and public.has_restaurant_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end,array['owner']));

alter table public.bite_coupons add constraint bite_coupon_finite check(discount_value::text not in ('NaN','Infinity','-Infinity') and coalesce(max_discount::text,'') not in ('NaN','Infinity','-Infinity') and minimum_order::text not in ('NaN','Infinity','-Infinity'));

create or replace function public.bite_admin_request_refund(p_order_id uuid,p_amount numeric,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;f public.order_financials%rowtype;v_id uuid:=gen_random_uuid();
begin
 if not public.is_platform_admin() then raise exception 'Admin access required';end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found or o.is_demo or o.channel<>'Own Platform' then raise exception 'Live marketplace order required';end if;
 select * into f from public.order_financials where order_id=o.id for update;
 if not found or f.payment_status not in ('paid','partially_refunded') or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<1 or p_amount<>round(p_amount,2) or p_amount>f.customer_payable_amount-f.refund_amount_actual then raise exception 'Refund amount exceeds verified refundable balance';end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Refund reason required';end if;
 insert into public.bite_refund_jobs(id,order_id,restaurant_id,customer_id,amount,reason,provider_refund_id) values(v_id,o.id,o.restaurant_id,o.customer_id,p_amount,p_reason,'bite_rf_'||replace(v_id::text,'-',''));
 return v_id;
end $$;
revoke all on function public.bite_admin_request_refund(uuid,numeric,text) from public,anon;
grant execute on function public.bite_admin_request_refund(uuid,numeric,text) to authenticated;
create or replace function public.bite_record_provider_refund(p_job_id uuid,p_provider_refund_id text,p_status text,p_amount numeric,p_currency text) returns text language plpgsql security definer set search_path='' as $$
declare j public.bite_refund_jobs%rowtype;f public.order_financials%rowtype;v_new_refund numeric;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service only';end if;
 select * into j from public.bite_refund_jobs where id=p_job_id for update;
 if not found or j.provider_refund_id is distinct from p_provider_refund_id or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>j.amount or p_currency is distinct from 'INR' then raise exception 'Refund provider evidence mismatch';end if;
 if j.status='succeeded' then return 'succeeded';end if;
 if j.approved_by is null or j.approved_at is null or j.status in ('pending_approval','rejected') then raise exception 'Refund approval required';end if;
 if p_status not in ('SUCCESS','PENDING','PENDING_APPROVAL','CANCELLED','ONHOLD','REJECTED') then raise exception 'Unknown provider refund status';end if;
 if p_status='SUCCESS' then
 select * into f from public.order_financials where order_id=j.order_id for update;
 v_new_refund:=f.refund_amount_actual+j.amount;
 if v_new_refund>f.customer_payable_amount then raise exception 'Refund exceeds original payment';end if;
 update public.order_financials set refund_amount_actual=v_new_refund,payment_status=case when v_new_refund=f.customer_payable_amount then 'refunded' else 'partially_refunded' end where order_id=j.order_id;
 end if;
 update public.bite_refund_jobs set status=case when p_status='SUCCESS' then 'succeeded' when p_status in ('CANCELLED','REJECTED') then 'failed' else 'submitted' end,provider_status=p_status,provider_checked_at=now(),updated_at=now(),last_error=null where id=j.id returning status into p_status;
 return p_status;
end $$;
revoke all on function public.bite_record_provider_refund(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.bite_record_provider_refund(uuid,text,text,numeric,text) to service_role;

-- A previously verified payment must still create an order if the owner closes while the customer pays.
-- Availability is checked at preparation. Only the service-only verified finalizer sets this marker.
create or replace function public.guard_marketplace_order_availability() returns trigger language plpgsql set search_path='' as $$
declare v_closed boolean;v_closed_until timestamptz;v_delivery_paused boolean;
begin
 if new.channel<>'Own Platform' then return new;end if;
 if coalesce(auth.jwt()->>'role','')='service_role' and current_setting('app.verified_checkout_activation',true)='true' then return new;end if;
 select r.is_temporarily_closed,r.temporary_closure_until,r.delivery_paused into v_closed,v_closed_until,v_delivery_paused from public.restaurants r where r.id=new.restaurant_id;
 if not found then raise exception 'Restaurant unavailable';end if;
 if coalesce(v_closed,false) and (v_closed_until is null or v_closed_until>now()) then raise exception 'Restaurant temporarily closed';end if;
 if new.delivery_type='delivery' and coalesce(v_delivery_paused,false) then raise exception 'Restaurant delivery paused';end if;
 return new;
end $$;
revoke all on function public.guard_marketplace_order_availability() from public,anon,authenticated;

alter table public.restaurant_expenses add constraint bite_expense_bill_tenant_path check(bill_path is null or bill_path like restaurant_id::text||'/%');

-- Hosted projects may give API roles broad default table grants. RLS and grants both enforce the intended API.
revoke all on public.bite_customer_controls,public.bite_customer_favourites,public.bite_storefront_categories,public.bite_featured_restaurants,public.bite_coupons,public.bite_operation_audit,public.bite_provider_checks,public.bite_refund_jobs,public.bite_operations_config,public.bite_restaurant_documents from public,anon,authenticated;
grant select on public.bite_customer_controls,public.bite_operation_audit,public.bite_provider_checks,public.bite_refund_jobs,public.bite_operations_config,public.bite_restaurant_documents to authenticated;
grant select,insert,delete on public.bite_customer_favourites to authenticated;
grant select on public.bite_coupons,public.bite_storefront_categories to anon,authenticated;
grant insert,update,delete on public.bite_storefront_categories to authenticated;
grant select,insert,update,delete on public.bite_featured_restaurants to authenticated;
grant insert on public.bite_restaurant_documents to authenticated;

-- Special numeric values cannot pass pricing or provider snapshot validation.
alter table public.menu_items add constraint bite_menu_price_finite check(price::text not in ('NaN','Infinity','-Infinity'));
alter table public.bite_live_checkout_intents add constraint bite_intent_prices_finite check(amount::text not in ('NaN','Infinity','-Infinity') and coalesce(food_subtotal::text,'') not in ('NaN','Infinity','-Infinity') and coalesce(delivery_fee::text,'') not in ('NaN','Infinity','-Infinity') and discount_amount::text not in ('NaN','Infinity','-Infinity'));
create or replace function public.bite_guard_acceptance_deadline() returns trigger language plpgsql security definer set search_path='' as $$
declare enabled_since timestamptz;
begin
 if old.status='Received' and new.status='Accepted' and new.channel='Own Platform' and not new.is_demo then
 select acceptance_timeout_enabled_since into enabled_since from public.bite_operations_config where id;
 if enabled_since is not null and old.order_date>=enabled_since and old.order_date<now()-interval '5 minutes' then raise exception 'Order acceptance deadline expired; cancellation/refund review is queued by the scheduler';end if;
 end if;return new;
end $$;
revoke all on function public.bite_guard_acceptance_deadline() from public,anon,authenticated;
create trigger bite_guard_acceptance_deadline before update of status on public.orders for each row execute function public.bite_guard_acceptance_deadline();

create or replace function public.bite_expire_unstarted_checkouts() returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service only';end if;
 update public.bite_live_checkout_intents set status='expired',updated_at=now() where status='awaiting_payment' and checkout_key is not null and provider_attempted_at is null and provider_order_id is null and created_at<now()-interval '20 minutes';
 get diagnostics v_count=row_count;return v_count;
end $$;
revoke all on function public.bite_expire_unstarted_checkouts() from public,anon,authenticated;
grant execute on function public.bite_expire_unstarted_checkouts() to service_role;
grant all on public.bite_operations_config to service_role;

create index bite_orders_period_idx on public.orders(order_date,restaurant_id) where channel='Own Platform' and not is_demo;
create or replace function public.bite_admin_business_metrics(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;v_start timestamptz;v_end timestamptz;v_previous timestamptz;
begin
 if not public.is_platform_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'Choose a date range of at most 366 days';end if;
 v_start:=p_from::timestamp at time zone 'Asia/Kolkata';v_end:=(p_to+1)::timestamp at time zone 'Asia/Kolkata';v_previous:=(p_from-(p_to-p_from+1))::timestamp at time zone 'Asia/Kolkata';
 with paid as(select o.id,o.restaurant_id,o.customer_id,o.status,f.customer_payable_amount,f.refund_amount_actual,f.food_subtotal,f.commission_amount,f.platform_discount,f.provider_fee_actual from public.orders o join public.order_financials f on f.order_id=o.id where o.channel='Own Platform' and not o.is_demo and not f.is_demo and o.order_date>=v_start and o.order_date<v_end and f.payment_status in ('paid','partially_refunded','refunded')),
 totals as(select count(*) n,count(*) filter(where status='Completed') completed,count(*) filter(where status in ('Cancelled','Rejected')) cancelled,coalesce(sum(customer_payable_amount),0) collections,coalesce(sum(refund_amount_actual),0) refunds,coalesce(sum(food_subtotal),0) food_gmv,coalesce(sum(commission_amount),0) commission,coalesce(sum(platform_discount),0) platform_discount,count(provider_fee_actual) fee_known_count,sum(provider_fee_actual) fees from paid),
 repeat_stats as(select count(*) unique_customers,count(*) filter(where cnt>=2) repeat_customers from(select customer_id,count(*) cnt from paid where customer_id is not null group by customer_id)c),
 previous_restaurants as(select distinct o.restaurant_id from public.orders o join public.order_financials f on f.order_id=o.id where o.channel='Own Platform' and not o.is_demo and not f.is_demo and o.status='Completed' and f.payment_status in ('paid','partially_refunded','refunded') and o.order_date>=v_previous and o.order_date<v_start),
 retained as(select count(*) previous_count,count(*) filter(where exists(select 1 from paid p where p.restaurant_id=r.restaurant_id and p.status='Completed')) retained_count from previous_restaurants r)
 select jsonb_build_object('paid_order_count',t.n,'completed_orders',t.completed,'cancelled_paid_orders',t.cancelled,'completion_percent',round(100.0*t.completed/nullif(t.n,0),2),'verified_collections',t.collections,'provider_confirmed_refunds',t.refunds,'collections_after_refunds',t.collections-t.refunds,'food_gmv_before_discount',t.food_gmv,'average_customer_payment',round(t.collections/nullif(t.n,0),2),'commission_booked',t.commission,'platform_funded_discounts',t.platform_discount,'gateway_fee_actual',case when t.fee_known_count=t.n and t.n>0 then t.fees else null end,'gateway_fee_known_orders',t.fee_known_count,'unique_paying_customers',r.unique_customers,'repeat_customer_percent',round(100.0*r.repeat_customers/nullif(r.unique_customers,0),2),'previous_active_restaurants',ret.previous_count,'retained_restaurant_percent',round(100.0*ret.retained_count/nullif(ret.previous_count,0),2),'customer_acquisition_cost',null,'visitor_conversion_percent',null,'contribution_margin',null,'coverage_note','No acquisition spend, consented visitor/session funnel or complete delivery/support/refund-cost ledger is configured. Commission is booked revenue, not net earnings.') into result from totals t cross join repeat_stats r cross join retained ret;
 return result;
end $$;
revoke all on function public.bite_admin_business_metrics(date,date) from public,anon;
grant execute on function public.bite_admin_business_metrics(date,date) to authenticated;

create index bite_checkout_customer_created_idx on public.bite_live_checkout_intents(customer_id,created_at desc);
create or replace function public.bite_guard_checkout_customer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.bite_customer_controls where customer_id=new.customer_id and (suspended or deletion_requested_at is not null)) then raise exception 'Account ordering is paused. Contact Bite support.';end if;
 perform pg_advisory_xact_lock(hashtextextended('bite-checkout-user:'||new.customer_id::text,0));
 if (select count(*) from public.bite_live_checkout_intents where customer_id=new.customer_id and created_at>now()-interval '1 minute')>=10 then raise exception 'Too many checkout attempts. Please wait one minute before retrying.';end if;
 return new;
end $$;
revoke all on function public.bite_guard_checkout_customer() from public,anon,authenticated;

-- Deleting a saved address must not erase an in-flight/paid checkout's immutable address.
alter table public.bite_live_checkout_intents drop constraint bite_live_checkout_intents_address_id_fkey;
alter table public.bite_live_checkout_intents add constraint bite_live_checkout_intents_address_id_fkey foreign key(address_id) references public.customer_addresses(id) on delete set null;
create or replace function public.bite_preserve_checkout_address_before_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.bite_live_checkout_intents set address_snapshot=coalesce(address_snapshot,to_jsonb(old)) where address_id=old.id and customer_id=old.customer_id;
 return old;
end $$;
revoke all on function public.bite_preserve_checkout_address_before_delete() from public,anon,authenticated;
create trigger bite_preserve_checkout_address_before_delete before delete on public.customer_addresses for each row execute function public.bite_preserve_checkout_address_before_delete();
