-- Bite marketplace restaurant delivery zones by Indian PIN code.
-- Apply to Supabase project wedbgpybbgsszcmffoha.

create table if not exists public.restaurant_delivery_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee>=0),
  minimum_order_amount numeric(12,2) not null default 0 check (minimum_order_amount>=0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(restaurant_id,name),
  unique(id,restaurant_id)
);
create table if not exists public.restaurant_delivery_zone_pincodes (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  created_at timestamptz not null default now(),
  unique(restaurant_id,postal_code),
  foreign key(zone_id,restaurant_id) references public.restaurant_delivery_zones(id,restaurant_id) on delete cascade
);
create index if not exists restaurant_delivery_zones_restaurant_idx on public.restaurant_delivery_zones(restaurant_id,is_active);
create index if not exists restaurant_delivery_zone_pincodes_postal_idx on public.restaurant_delivery_zone_pincodes(postal_code,restaurant_id);
alter table public.restaurant_delivery_zones enable row level security;
alter table public.restaurant_delivery_zone_pincodes enable row level security;

drop policy if exists "restaurant teams read delivery zones" on public.restaurant_delivery_zones;
create policy "restaurant teams read delivery zones" on public.restaurant_delivery_zones for select to authenticated using (public.is_restaurant_member(restaurant_id));
drop policy if exists "owners managers manage delivery zones" on public.restaurant_delivery_zones;
create policy "owners managers manage delivery zones" on public.restaurant_delivery_zones for all to authenticated using (public.has_restaurant_role(restaurant_id,array['owner','manager'])) with check (public.has_restaurant_role(restaurant_id,array['owner','manager']));
drop policy if exists "restaurant teams read delivery zone pincodes" on public.restaurant_delivery_zone_pincodes;
create policy "restaurant teams read delivery zone pincodes" on public.restaurant_delivery_zone_pincodes for select to authenticated using (public.is_restaurant_member(restaurant_id));
drop policy if exists "owners managers manage delivery zone pincodes" on public.restaurant_delivery_zone_pincodes;
create policy "owners managers manage delivery zone pincodes" on public.restaurant_delivery_zone_pincodes for all to authenticated using (public.has_restaurant_role(restaurant_id,array['owner','manager'])) with check (public.has_restaurant_role(restaurant_id,array['owner','manager']) and exists(select 1 from public.restaurant_delivery_zones z where z.id=zone_id and z.restaurant_id=restaurant_delivery_zone_pincodes.restaurant_id));
grant select,insert,update,delete on public.restaurant_delivery_zones,public.restaurant_delivery_zone_pincodes to authenticated;

create or replace function public.save_restaurant_delivery_zone(p_restaurant_id uuid,p_zone_id uuid,p_name text,p_postal_codes text[],p_delivery_fee numeric,p_minimum_order_amount numeric,p_is_active boolean)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_zone_id uuid; v_codes text[];
begin
 if auth.uid() is null then raise exception 'Restaurant login required.'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager']) then raise exception 'Owner/Manager access required.'; end if;
 if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>80 then raise exception 'Zone name must be 2 to 80 characters.'; end if;
 if p_delivery_fee is null or p_delivery_fee<0 or p_minimum_order_amount is null or p_minimum_order_amount<0 then raise exception 'Delivery fee and minimum order must be zero or more.'; end if;
 select array_agg(btrim(code) order by btrim(code)) into v_codes from unnest(coalesce(p_postal_codes,'{}'::text[])) as codes(code);
 if v_codes is null or cardinality(v_codes)<1 or cardinality(v_codes)>50 then raise exception 'Add between 1 and 50 PIN codes to this zone.'; end if;
 if exists(select 1 from unnest(v_codes) c where c !~ '^[0-9]{6}$') then raise exception 'Every PIN code must contain exactly 6 digits.'; end if;
 if cardinality(v_codes)<>(select count(distinct c) from unnest(v_codes) c) then raise exception 'Duplicate PIN codes exist in this zone.'; end if;
 if exists(select 1 from public.restaurant_delivery_zone_pincodes zp where zp.restaurant_id=p_restaurant_id and zp.postal_code=any(v_codes) and (p_zone_id is null or zp.zone_id<>p_zone_id)) then raise exception 'A PIN code is already assigned to another delivery zone.'; end if;
 if p_zone_id is null then
  insert into public.restaurant_delivery_zones(restaurant_id,name,delivery_fee,minimum_order_amount,is_active,created_by)
  values(p_restaurant_id,btrim(p_name),p_delivery_fee,p_minimum_order_amount,coalesce(p_is_active,true),auth.uid()) returning id into v_zone_id;
 else
  update public.restaurant_delivery_zones set name=btrim(p_name),delivery_fee=p_delivery_fee,minimum_order_amount=p_minimum_order_amount,is_active=coalesce(p_is_active,true),updated_at=now()
   where id=p_zone_id and restaurant_id=p_restaurant_id returning id into v_zone_id;
  if v_zone_id is null then raise exception 'Delivery zone not found for this restaurant.'; end if;
 end if;
 delete from public.restaurant_delivery_zone_pincodes where zone_id=v_zone_id and restaurant_id=p_restaurant_id;
 insert into public.restaurant_delivery_zone_pincodes(zone_id,restaurant_id,postal_code)
 select v_zone_id,p_restaurant_id,c from unnest(v_codes) c;
 return v_zone_id;
end;
$function$;

create or replace function public.delete_restaurant_delivery_zone(p_restaurant_id uuid,p_zone_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $function$
begin
 if auth.uid() is null or not public.has_restaurant_role(p_restaurant_id,array['owner','manager']) then raise exception 'Owner/Manager access required.'; end if;
 delete from public.restaurant_delivery_zones where id=p_zone_id and restaurant_id=p_restaurant_id;
 if not found then raise exception 'Delivery zone not found.'; end if;
 return true;
end;
$function$;

create or replace function public.check_restaurant_delivery_area(p_restaurant_id uuid,p_postal_code text)
returns table(serviceable boolean,zone_name text,delivery_fee numeric,minimum_order_amount numeric)
language sql stable security definer set search_path=''
as $function$
 select (z.id is not null),z.name,
  coalesce(z.delivery_fee,r.default_delivery_fee,0),
  greatest(coalesce(r.minimum_order_amount,0),coalesce(z.minimum_order_amount,0))
 from public.restaurants r
 left join public.restaurant_delivery_zone_pincodes zp on zp.restaurant_id=r.id and zp.postal_code=regexp_replace(coalesce(p_postal_code,''),'[^0-9]','','g')
 left join public.restaurant_delivery_zones z on z.id=zp.zone_id and z.restaurant_id=r.id and z.is_active
 where r.id=p_restaurant_id and r.is_published and r.status='Active';
$function$;
revoke execute on function public.save_restaurant_delivery_zone(uuid,uuid,text,text[],numeric,numeric,boolean) from public,anon;
grant execute on function public.save_restaurant_delivery_zone(uuid,uuid,text,text[],numeric,numeric,boolean) to authenticated;
revoke execute on function public.delete_restaurant_delivery_zone(uuid,uuid) from public,anon;
grant execute on function public.delete_restaurant_delivery_zone(uuid,uuid) to authenticated;
revoke execute on function public.check_restaurant_delivery_area(uuid,text) from public;
grant execute on function public.check_restaurant_delivery_area(uuid,text) to anon,authenticated;

-- Add serviceability check to the customer order RPC, and keep the unpaid-order block
-- after server-side validation. This makes the delivery restriction server-enforced.
do $do$
declare v_def text; v_old text; v_new text;
begin
 select pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure) into v_def;
 if position('v_postal_code text' in v_def)=0 then
  v_def:=replace(v_def,'v_order_code text;','v_order_code text; v_postal_code text; v_zone_fee numeric(12,2); v_zone_minimum numeric(12,2);');
 end if;
 v_old:='raise exception ''Online marketplace payment is not configured. Order placement is disabled until an approved payment provider is connected.'';';
 v_def:=replace(v_def,v_old,'');
 v_old:='v_address := v_address || jsonb_build_object(''recipient_name'',v_name,''recipient_phone'',v_phone);';
 v_new:=v_old || E'\n if p_delivery_type=''delivery'' then\n  v_postal_code:=regexp_replace(coalesce(v_address->>''postal_code'',''''),''[^0-9]'','''',''g'');\n  if length(v_postal_code)<>6 then raise exception ''Enter a valid 6-digit delivery PIN code.''; end if;\n  select z.delivery_fee,z.minimum_order_amount into v_zone_fee,v_zone_minimum\n   from public.restaurant_delivery_zone_pincodes zp join public.restaurant_delivery_zones z on z.id=zp.zone_id and z.restaurant_id=zp.restaurant_id\n   where zp.restaurant_id=p_restaurant_id and zp.postal_code=v_postal_code and z.is_active;\n  if not found then raise exception ''This restaurant does not deliver to the selected PIN code.''; end if;\n  v_delivery_fee:=v_zone_fee; v_minimum:=greatest(v_minimum,v_zone_minimum);\n end if;';
 if position('v_postal_code:=regexp_replace' in v_def)=0 then
  if position(v_old in v_def)=0 then raise exception 'Customer address snapshot validation anchor not found'; end if;
  v_def:=replace(v_def,v_old,v_new);
 end if;
 v_old:='raise exception ''Order is below this restaurant minimum order amount.''; end if;';
 v_new:=v_old || E'\n raise exception ''Online marketplace payment is not configured. Order placement is disabled until an approved payment provider is connected.'';';
 if position('Online marketplace payment is not configured' in v_def)=0 then
  v_def:=replace(v_def,v_old,v_new);
 end if;
 if position('v_postal_code:=regexp_replace' in v_def)=0 or position('Online marketplace payment is not configured' in v_def)=0 then raise exception 'Marketplace PIN/payment guards were not applied'; end if;
 execute v_def;
end $do$;
select position('v_postal_code:=regexp_replace' in pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure))>0 as order_pincode_guard_present,
       position('Online marketplace payment is not configured' in pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure))>0 as payment_guard_present;