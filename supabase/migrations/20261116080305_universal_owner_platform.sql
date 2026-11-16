-- Additive Owner OS. No existing restaurant/order/payment record is replaced.
-- Financial writes go through authenticated, property-locked commands.
create schema if not exists private;

create table public.bite_businesses (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 120),
 created_at timestamptz not null default now(), unique(owner_id)
);
create table public.bite_properties (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.bite_businesses(id),
 origin_restaurant_id uuid unique references public.restaurants(id),
 name text not null check(length(trim(name)) between 1 and 120),
 business_type text not null check(business_type in ('restaurant','hotel','hybrid')),
 capabilities text[] not null,
 address text not null default '', phone text not null default '',
 timezone text not null default 'Asia/Kolkata' check(timezone='Asia/Kolkata'),
 checkin_time time not null default '12:00', checkout_time time not null default '11:00',
 tax_profile jsonb not null default '{"reviewed":false}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.bite_property_members (
 property_id uuid not null references public.bite_properties(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','manager','receptionist','cashier','housekeeping','accountant')),
 active boolean not null default true,
 primary key(property_id,user_id)
);
create index bite_property_members_user on public.bite_property_members(user_id,property_id) where active;
create table public.bite_property_outlets (
 property_id uuid not null references public.bite_properties(id),
 restaurant_id uuid not null unique references public.restaurants(id),
 primary key(property_id,restaurant_id)
);
create table public.bite_rooms (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.bite_properties(id),
 number text not null check(length(trim(number)) between 1 and 20),
 room_type text not null check(length(trim(room_type)) between 1 and 60), floor text not null default '',
 nightly_rate numeric(14,2) not null check(nightly_rate between 0 and 999999999999.99),
 adults integer not null default 2 check(adults between 1 and 20),
 children integer not null default 2 check(children between 0 and 20),
 housekeeping text not null default 'ready' check(housekeeping in ('ready','dirty','cleaning','blocked')),
 status_note text not null default '', active boolean not null default true,
 unique(property_id,number), unique(property_id,id)
);
create table public.bite_guests (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.bite_properties(id),
 full_name text not null check(length(trim(full_name)) between 1 and 120),
 phone text not null check(length(phone) between 7 and 20),
 country text not null default 'India' check(length(country) between 1 and 60),
 email text not null default '', address text not null default '',
 id_type text not null default '' check(length(id_type)<=40),
 id_last4 text not null default '' check(length(id_last4)<=4),
 created_at timestamptz not null default now(), unique(property_id,id)
);
create index bite_guests_phone on public.bite_guests(property_id,phone);
create table public.bite_stays (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.bite_properties(id),
 guest_id uuid not null, room_id uuid not null,
 arrival date not null, departure date not null check(departure>arrival),
 adults integer not null check(adults between 1 and 20), children integer not null default 0 check(children between 0 and 20),
 nightly_rate numeric(14,2) not null check(nightly_rate between 0 and 999999999999.99),
 room_tax_rate numeric(6,3) not null default 0 check(room_tax_rate between 0 and 100),
 status text not null default 'reserved' check(status in ('reserved','in_house','checked_out','cancelled','no_show')),
 checked_in_at timestamptz, checked_out_at timestamptz,
 compliance_note text not null default '', created_at timestamptz not null default now(),
 unique(property_id,id),
 foreign key(property_id,guest_id) references public.bite_guests(property_id,id),
 foreign key(property_id,room_id) references public.bite_rooms(property_id,id)
);
create index bite_stays_room_dates on public.bite_stays(property_id,room_id,arrival,departure) where status in ('reserved','in_house');
create table public.bite_folios (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.bite_properties(id),
 stay_id uuid not null unique, status text not null default 'open' check(status in ('open','settled')),
 invoice_number text unique, invoice_snapshot jsonb, settled_at timestamptz,
 unique(property_id,id), foreign key(property_id,stay_id) references public.bite_stays(property_id,id)
);
create table public.bite_folio_entries (
 id uuid primary key default gen_random_uuid(), property_id uuid not null, folio_id uuid not null,
 kind text not null check(kind in ('charge','discount','reversal','payment','refund','deposit_hold','deposit_return','deposit_apply')),
 category text not null check(category in ('room','incidental','food','payment','deposit')),
 description text not null check(length(trim(description)) between 1 and 250),
 amount numeric(14,2) not null check(amount>0 and amount<=999999999999.99),
 tax_amount numeric(14,2) not null default 0 check(tax_amount between 0 and 999999999999.99),
 status text not null default 'confirmed' check(status in ('pending','confirmed','void')),
 method text check(method in ('Cash','UPI','Card','Bank Transfer','Other')),
 reference text not null default '' check(length(reference)<=100),
 source_order_id uuid unique references public.orders(id), reversal_of uuid unique references public.bite_folio_entries(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(property_id,folio_id) references public.bite_folios(property_id,id)
);
create index bite_folio_entries_scope on public.bite_folio_entries(property_id,folio_id,created_at);
create table public.bite_property_commands (
 property_id uuid not null references public.bite_properties(id), request_id uuid not null,
 action text not null, payload jsonb not null, result jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(property_id,request_id)
);
create table public.bite_property_audit (
 id bigint generated always as identity primary key, property_id uuid not null references public.bite_properties(id),
 actor_id uuid not null references auth.users(id), action text not null, entity_id uuid,
 request_id uuid not null, created_at timestamptz not null default now()
);
create index bite_property_audit_scope on public.bite_property_audit(property_id,created_at desc);
create table public.bite_property_expenses (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.bite_properties(id),
 description text not null check(length(trim(description)) between 1 and 250),
 amount numeric(14,2) not null check(amount>0 and amount<=999999999999.99), expense_date date not null,
 method text not null check(method in ('Cash','UPI','Card','Bank Transfer','Other')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index bite_property_expenses_scope on public.bite_property_expenses(property_id,expense_date);

create function private.bite_default_capabilities(p_type text) returns text[]
language sql immutable set search_path='' as $$
 select array['expenses','staff_management','reporting']::text[] ||
 case when p_type in ('hotel','hybrid') then array['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals'] else '{}'::text[] end ||
 case when p_type in ('restaurant','hybrid') then array['restaurant_pos','restaurant_menu','dine_in','takeaway','online_food_orders','inventory'] else '{}'::text[] end ||
 case when p_type='hybrid' then array['room_service','charge_to_room'] else '{}'::text[] end
$$;
create function private.bite_property_role(p_property uuid) returns text
language sql stable security definer set search_path='' as $$
 select m.role from public.bite_property_members m
 where m.property_id=p_property and m.user_id=(select auth.uid()) and m.active
 and not public.is_platform_admin()
$$;
create function private.bite_can(p_property uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select
  case when p_capability='manage_modules' then private.bite_property_role(p_property)='owner'
  when p_capability='membership' then private.bite_property_role(p_property) is not null
  else p_capability=any(p.capabilities) and
   (private.bite_property_role(p_property) in ('owner','manager') or
    (private.bite_property_role(p_property)='receptionist' and p_capability=any(array['hotel_rooms','guest_register','reservations','folios','housekeeping','hotel_incidentals'])) or
    (private.bite_property_role(p_property)='housekeeping' and p_capability=any(array['hotel_rooms','housekeeping'])) or
    (private.bite_property_role(p_property)='cashier' and p_capability=any(array['restaurant_pos','restaurant_menu','dine_in','takeaway','room_service','charge_to_room'])) or
    (private.bite_property_role(p_property)='accountant' and p_capability=any(array['reporting','folios']))) end
 from public.bite_properties p where p.id=p_property),false)
$$;
create function private.bite_folio_totals(p_folio uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'charges',coalesce(sum(case when kind='charge' then amount+tax_amount when kind in ('discount','reversal') then -amount-tax_amount else 0 end) filter(where status='confirmed'),0),
  'paid',coalesce(sum(case when kind in ('payment','deposit_apply') then amount when kind='refund' then -amount else 0 end) filter(where status='confirmed'),0),
  'balance',coalesce(sum(case when kind='charge' then amount+tax_amount when kind in ('discount','reversal','payment','deposit_apply') then -amount-tax_amount when kind='refund' then amount else 0 end) filter(where status='confirmed'),0),
  'deposit_held',coalesce(sum(case when kind='deposit_hold' then amount when kind in ('deposit_return','deposit_apply') then -amount else 0 end) filter(where status='confirmed'),0),
  'pending',coalesce(sum(amount) filter(where status='pending'),0))
 from public.bite_folio_entries where folio_id=p_folio
$$;

-- No direct browser writes. RLS is defense in depth for reads; commands below
-- check auth, role and capabilities before accessing any private data.
do $$ declare t text; begin
 foreach t in array array['bite_businesses','bite_properties','bite_property_members','bite_property_outlets','bite_rooms','bite_guests','bite_stays','bite_folios','bite_folio_entries','bite_property_commands','bite_property_audit','bite_property_expenses'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
grant select on public.bite_properties,public.bite_property_members,public.bite_property_outlets,public.bite_rooms,public.bite_guests,public.bite_stays,public.bite_folios,public.bite_folio_entries,public.bite_property_audit to authenticated;
grant select on public.bite_property_expenses to authenticated;
create policy property_expenses_read on public.bite_property_expenses for select to authenticated using(private.bite_can(property_id,'expenses'));
create policy property_read on public.bite_properties for select to authenticated using(private.bite_can(id,'membership'));
create policy property_members_read on public.bite_property_members for select to authenticated using(user_id=(select auth.uid()) or private.bite_can(property_id,'manage_modules'));
create policy property_outlets_read on public.bite_property_outlets for select to authenticated using(private.bite_can(property_id,'membership'));
create policy rooms_read on public.bite_rooms for select to authenticated using(private.bite_can(property_id,'hotel_rooms'));
create policy guests_read on public.bite_guests for select to authenticated using(private.bite_can(property_id,'guest_register'));
create policy stays_read on public.bite_stays for select to authenticated using(private.bite_can(property_id,'reservations'));
create policy folios_read on public.bite_folios for select to authenticated using(private.bite_can(property_id,'folios'));
create policy entries_read on public.bite_folio_entries for select to authenticated using(private.bite_can(property_id,'folios'));
create policy property_audit_read on public.bite_property_audit for select to authenticated using(private.bite_can(property_id,'reporting'));

-- Existing restaurant owners get defaults without changing old IDs or records.
insert into public.bite_businesses(owner_id,name)
select distinct on (rm.user_id) rm.user_id,r.name from public.restaurant_members rm
join public.restaurants r on r.id=rm.restaurant_id
where rm.role='owner' and not exists(select 1 from public.platform_admins a where a.user_id=rm.user_id)
order by rm.user_id,r.id on conflict(owner_id) do nothing;
insert into public.bite_properties(business_id,origin_restaurant_id,name,business_type,capabilities,address,phone)
select b.id,r.id,r.name,'restaurant',private.bite_default_capabilities('restaurant'),coalesce(r.address,''),coalesce(r.phone,'')
from public.restaurants r join public.restaurant_members rm on rm.restaurant_id=r.id and rm.role='owner'
join public.bite_businesses b on b.owner_id=rm.user_id
where (select count(*) from public.restaurant_members m where m.restaurant_id=r.id and m.role='owner')=1
on conflict(origin_restaurant_id) do nothing;
insert into public.bite_property_members(property_id,user_id,role)
select p.id,b.owner_id,'owner' from public.bite_properties p join public.bite_businesses b on b.id=p.business_id
on conflict do nothing;
insert into public.bite_property_outlets(property_id,restaurant_id)
select id,origin_restaurant_id from public.bite_properties where origin_restaurant_id is not null on conflict do nothing;

create function private.bite_owner_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.is_platform_admin() then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'business_type',p.business_type,
  'address',p.address,'phone',p.phone,'tax_profile',p.tax_profile,'checkin_time',p.checkin_time,'checkout_time',p.checkout_time,
  'role',m.role,'capabilities',(select coalesce(jsonb_agg(c),'[]'::jsonb) from unnest(p.capabilities) c where private.bite_can(p.id,c)),
  'configured_capabilities',case when m.role='owner' then to_jsonb(p.capabilities) else null end,
  'can_configure',m.role='owner','outlets',(select coalesce(jsonb_agg(o.restaurant_id),'[]'::jsonb) from public.bite_property_outlets o where o.property_id=p.id)) order by p.created_at)
  from public.bite_properties p join public.bite_property_members m on m.property_id=p.id
  where m.user_id=auth.uid() and m.active),'[]'::jsonb);
end $$;
create function public.bite_owner_context() returns jsonb language sql security invoker set search_path='' as $$select private.bite_owner_context()$$;

create function private.bite_create_property(p_name text,p_type text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare b uuid; existing uuid; p uuid;
begin
 if auth.uid() is null or public.is_platform_admin() then raise exception 'Owner login required' using errcode='42501'; end if;
 if p_type not in ('restaurant','hotel','hybrid') or p_request is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Valid property name and type required'; end if;
 insert into public.bite_businesses(owner_id,name) values(auth.uid(),trim(p_name)) on conflict(owner_id) do nothing;
 select id into b from public.bite_businesses where owner_id=auth.uid() for update;
 select entity_id into existing from public.bite_property_audit where actor_id=auth.uid() and request_id=p_request and action='create_property';
 if existing is not null then
  if not exists(select 1 from public.bite_properties where id=existing and name=trim(p_name) and business_type=p_type) then raise exception 'Request ID reused with different property'; end if;
  return existing;
 end if;
 insert into public.bite_properties(business_id,name,business_type,capabilities) values(b,trim(p_name),p_type,private.bite_default_capabilities(p_type)) returning id into p;
 insert into public.bite_property_members values(p,auth.uid(),'owner',true);
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p,auth.uid(),'create_property',p,p_request);
 return p;
end $$;
create function public.bite_create_property(p_name text,p_type text,p_request uuid) returns uuid language sql security invoker set search_path='' as $$select private.bite_create_property(p_name,p_type,p_request)$$;

create function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 prop public.bite_properties; prior public.bite_property_commands;
 room public.bite_rooms; stay public.bite_stays; folio public.bite_folios; entry public.bite_folio_entries;
 caps text[]; cap text; role_name text; entity uuid; guest uuid; room_id uuid; folio_id uuid;
 amount numeric(14,2); tax numeric(14,2); rate numeric(6,3); total jsonb; result jsonb;
 v_arrival date; v_departure date; n integer; a integer; c integer; old_room uuid; kind text; stat text; desc_text text;
 invoice jsonb; rid uuid; order_id uuid; ord public.orders;
begin
 if auth.uid() is null or p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Authenticated request ID and payload required' using errcode='42501'; end if;
 role_name:=private.bite_property_role(p_property);
 if role_name is null then raise exception 'Property access denied' using errcode='42501'; end if;
 cap:=case
  when p_action in ('config','member') then 'manage_modules'
  when p_action in ('room_save','room_status') then 'housekeeping'
  when p_action='guest_save' then 'guest_register'
  when p_action in ('reserve','checkin','move','extend','cancel','no_show') then 'reservations'
  when p_action in ('room_post','room_pos') then 'charge_to_room'
  when p_action='expense' then 'expenses'
  else 'folios' end;
 if not private.bite_can(p_property,cap) then raise exception 'Module or role does not permit this action' using errcode='42501'; end if;
 if role_name='accountant' then raise exception 'Read-only accounting access' using errcode='42501'; end if;
 if p_action in ('room_save','discount','reverse','refund','payment_confirm','expense') and role_name not in ('owner','manager') then raise exception 'Owner or manager authorization required' using errcode='42501'; end if;
 -- One property's writes serialize: allocation, ledger writes, config disable and
 -- checkout cannot race. No locks on unrelated restaurant/payment workflows.
 select * into strict prop from public.bite_properties where id=p_property for update;
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details'; end if;
  return prior.result;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;

 if p_action='config' then
  select coalesce(array_agg(value),'{}'::text[]) into caps from jsonb_array_elements_text(p_payload->'capabilities');
  if caps is null or not caps <@ private.bite_default_capabilities('hybrid') then raise exception 'Unknown business module'; end if;
  if p_payload->>'business_type' not in ('restaurant','hotel','hybrid') then raise exception 'Choose a valid business type'; end if;
  if ('hotel_rooms'=any(caps)) <> ('folios'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('reservations'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('guest_register'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('housekeeping'=any(caps)) or ('hotel_rooms'=any(caps)) <> ('hotel_incidentals'=any(caps)) then raise exception 'Hotel rooms, register, reservations, folios, housekeeping and incidentals must stay enabled together'; end if;
  if ('charge_to_room'=any(caps) or 'room_service'=any(caps)) and not (array['hotel_rooms','folios','restaurant_pos','restaurant_menu'] <@ caps) then raise exception 'Room service and room charging require hotel folios and restaurant POS/menu'; end if;
  if ('restaurant_pos'=any(caps) or 'online_food_orders'=any(caps)) and not 'restaurant_menu'=any(caps) then raise exception 'POS and online orders require Menu'; end if;
  if ('dine_in'=any(caps) or 'takeaway'=any(caps)) and not 'restaurant_pos'=any(caps) then raise exception 'Dine-in and takeaway require POS'; end if;
  if p_payload->>'business_type'='hotel' and caps && array['restaurant_pos','restaurant_menu','online_food_orders','dine_in','takeaway','room_service','charge_to_room'] then raise exception 'Hotel-only cannot enable restaurant modules'; end if;
  if p_payload->>'business_type'='restaurant' and 'hotel_rooms'=any(caps) then raise exception 'Choose Hybrid to add rooms to a restaurant'; end if;
  if 'hotel_rooms'=any(prop.capabilities) and not 'hotel_rooms'=any(caps) and
   (exists(select 1 from public.bite_stays where property_id=p_property and status in ('reserved','in_house')) or exists(select 1 from public.bite_folios f where f.property_id=p_property and (f.status='open' or (private.bite_folio_totals(f.id)->>'deposit_held')::numeric<>0))) then raise exception 'Active stays, reservations or unsettled folios prevent disabling hotel modules'; end if;
  if not array['restaurant_pos','restaurant_menu','online_food_orders'] <@ caps and exists(
   select 1 from public.bite_property_outlets o join public.orders r on r.restaurant_id=o.restaurant_id
   where o.property_id=p_property and (r.status in ('Received','Accepted','Preparing','Ready','Handed Over') or exists(select 1 from public.bite_refund_jobs j where j.order_id=r.id and j.status not in ('succeeded','cancelled')))) then raise exception 'Resolve active orders/refunds before disabling food modules'; end if;
  if 'restaurant_pos'=any(prop.capabilities) and not 'restaurant_pos'=any(caps) and exists(
   select 1 from public.bite_property_outlets o join public.restaurant_order_payment_summaries s on s.restaurant_id=o.restaurant_id
   where o.property_id=p_property and s.balance_amount>0) then raise exception 'Resolve unpaid POS balances before disabling POS'; end if;
  if 'online_food_orders'=any(prop.capabilities) and not 'online_food_orders'=any(caps) and exists(
   select 1 from public.bite_property_outlets o join public.bite_live_checkout_intents i on i.restaurant_id=o.restaurant_id
   where o.property_id=p_property and i.status not in ('expired','cancelled','failed','activated')) then raise exception 'Resolve pending online checkouts before disabling online ordering'; end if;
  if coalesce((p_payload->'tax_profile'->>'reviewed')::boolean,false) then
   if nullif(p_payload->'tax_profile'->>'gstin','') is not null and (p_payload->'tax_profile'->>'gstin') !~ '^[0-9]{2}[A-Z0-9]{13}$' then raise exception 'GSTIN format invalid'; end if;
   if coalesce((p_payload->'tax_profile'->>'room_rate')::numeric,0) not between 0 and 100 or coalesce((p_payload->'tax_profile'->>'incidental_rate')::numeric,0) not between 0 and 100 then raise exception 'Tax rate invalid'; end if;
  end if;
  update public.bite_properties set name=trim(p_payload->>'name'),business_type=p_payload->>'business_type',capabilities=caps,
   address=left(coalesce(p_payload->>'address',''),500),phone=left(coalesce(p_payload->>'phone',''),20),
   tax_profile=coalesce(p_payload->'tax_profile','{"reviewed":false}'::jsonb),updated_at=now() where id=p_property;
  entity:=p_property;
 elsif p_action='expense' then
  if (p_payload->>'amount')::numeric<>round((p_payload->>'amount')::numeric,2) then raise exception 'Maximum two decimal places'; end if;
  insert into public.bite_property_expenses(property_id,description,amount,expense_date,method,created_by)
  values(p_property,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'expense_date')::date,p_payload->>'method',auth.uid()) returning id into entity;
 elsif p_action='member' then
  if p_payload->>'role' not in ('manager','receptionist','cashier','housekeeping','accountant') then raise exception 'Choose a permitted staff role'; end if;
  if entity=(select owner_id from public.bite_businesses where id=prop.business_id) or exists(select 1 from public.platform_admins where user_id=entity) then raise exception 'Cannot reassign property owner or platform admin'; end if;
  if not exists(select 1 from auth.users where id=entity) then raise exception 'Registered user ID required'; end if;
  insert into public.bite_property_members values(p_property,entity,p_payload->>'role',coalesce((p_payload->>'active')::boolean,true))
   on conflict(property_id,user_id) do update set role=excluded.role,active=excluded.active;
 elsif p_action='room_save' then
  if entity is null then
   insert into public.bite_rooms(property_id,number,room_type,floor,nightly_rate,adults,children)
   values(p_property,trim(p_payload->>'number'),trim(p_payload->>'room_type'),left(coalesce(p_payload->>'floor',''),30),(p_payload->>'nightly_rate')::numeric,(p_payload->>'adults')::integer,coalesce((p_payload->>'children')::integer,0)) returning id into entity;
  else
   select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
   if exists(select 1 from public.bite_stays where room_id=entity and status in ('reserved','in_house')) and not coalesce((p_payload->>'active')::boolean,true) then raise exception 'Room has active or reserved stays'; end if;
   update public.bite_rooms set number=trim(p_payload->>'number'),room_type=trim(p_payload->>'room_type'),floor=left(coalesce(p_payload->>'floor',''),30),nightly_rate=(p_payload->>'nightly_rate')::numeric,adults=(p_payload->>'adults')::integer,children=coalesce((p_payload->>'children')::integer,0),active=coalesce((p_payload->>'active')::boolean,true) where id=entity;
  end if;
 elsif p_action='room_status' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  stat:=p_payload->>'status';
  if stat not in ('ready','dirty','cleaning','blocked') then raise exception 'Invalid room status'; end if;
  if stat='ready' and role_name='housekeeping' then raise exception 'Supervisor must inspect and mark Ready' using errcode='42501'; end if;
  if stat='blocked' and role_name not in ('owner','manager') then raise exception 'Manager must block rooms' using errcode='42501'; end if;
  if stat='blocked' and exists(select 1 from public.bite_stays where room_id=entity and status='in_house') then raise exception 'Move guest before blocking occupied room'; end if;
  update public.bite_rooms set housekeeping=stat,status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='guest_save' then
  if entity is null then
   insert into public.bite_guests(property_id,full_name,phone,country,email,address,id_type,id_last4)
   values(p_property,trim(p_payload->>'full_name'),trim(p_payload->>'phone'),coalesce(nullif(trim(p_payload->>'country'),''),'India'),left(coalesce(p_payload->>'email',''),120),left(coalesce(p_payload->>'address',''),500),coalesce(p_payload->>'id_type',''),coalesce(p_payload->>'id_last4','')) returning id into entity;
  else
   update public.bite_guests set full_name=trim(p_payload->>'full_name'),phone=trim(p_payload->>'phone'),country=coalesce(nullif(trim(p_payload->>'country'),''),'India'),email=left(coalesce(p_payload->>'email',''),120),address=left(coalesce(p_payload->>'address',''),500),id_type=coalesce(p_payload->>'id_type',''),id_last4=coalesce(p_payload->>'id_last4','') where id=entity and property_id=p_property;
   if not found then raise exception 'Guest not found'; end if;
  end if;
 elsif p_action='reserve' then
  guest:=(p_payload->>'guest_id')::uuid; room_id:=(p_payload->>'room_id')::uuid;
  v_arrival:=(p_payload->>'arrival')::date; v_departure:=(p_payload->>'departure')::date;
  a:=(p_payload->>'adults')::integer; c:=coalesce((p_payload->>'children')::integer,0);
  select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active;
  if v_arrival is null or v_departure is null or v_departure<=v_arrival or v_departure-v_arrival>365 then raise exception 'Choose valid stay dates (maximum 365 nights)'; end if;
  if room.housekeeping='blocked' then raise exception 'Room is blocked for maintenance'; end if;
  if a>room.adults or c>room.children then raise exception 'Room occupancy limit exceeded'; end if;
  if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(v_arrival,v_departure,'[)')) then raise exception 'Room already reserved for these dates'; end if;
  amount:=coalesce((p_payload->>'nightly_rate')::numeric,room.nightly_rate);
  if amount<>room.nightly_rate and role_name not in ('owner','manager') then raise exception 'Manager approval required for rate override' using errcode='42501'; end if;
  rate:=case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.tax_profile->>'room_rate')::numeric,0) else 0 end;
  insert into public.bite_stays(property_id,guest_id,room_id,arrival,departure,adults,children,nightly_rate,room_tax_rate,compliance_note)
  values(p_property,guest,room.id,v_arrival,v_departure,a,c,amount,rate,left(coalesce(p_payload->>'compliance_note',''),250)) returning id into entity;
  insert into public.bite_folios(property_id,stay_id) values(p_property,entity) returning id into folio_id;
 elsif p_action in ('checkin','move','extend','cancel','no_show') then
  select * into strict stay from public.bite_stays where id=entity and property_id=p_property;
  select * into strict folio from public.bite_folios where stay_id=stay.id and property_id=p_property;
  if folio.status<>'open' then raise exception 'Folio already settled'; end if;
  if p_action='checkin' then
   if stay.status='in_house' then result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'already_complete',true);
   else
    if stay.status<>'reserved' then raise exception 'Reservation is not available for check-in'; end if;
    if stay.arrival>(now() at time zone prop.timezone)::date then raise exception 'Arrival date is in the future'; end if;
    if stay.departure<=(now() at time zone prop.timezone)::date then raise exception 'Update expired reservation dates before check-in'; end if;
    select * into strict room from public.bite_rooms where id=stay.room_id and property_id=p_property and active;
    if room.housekeeping<>'ready' or exists(select 1 from public.bite_stays where room_id=room.id and status='in_house') then raise exception 'Room is occupied or not inspected Ready'; end if;
    update public.bite_stays set status='in_house',checked_in_at=now() where id=stay.id;
    amount:=stay.nightly_rate*(stay.departure-stay.arrival); tax:=round(amount*stay.room_tax_rate/100,2);
    if amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by) values(p_property,folio.id,'charge','room',(stay.departure-stay.arrival)||' nights · room '||room.number,amount,tax,auth.uid()); end if;
   end if;
  elsif p_action='move' then
   if stay.status<>'in_house' then raise exception 'Only an occupied stay can move rooms'; end if;
   room_id:=(p_payload->>'room_id')::uuid;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping='ready';
   if room.id=stay.room_id then raise exception 'Select another room'; end if;
   if room.adults<stay.adults or room.children<stay.children then raise exception 'Room occupancy limit exceeded'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.arrival,stay.departure,'[)')) then raise exception 'Target room has conflicting stay'; end if;
   update public.bite_rooms set housekeeping='dirty' where id=stay.room_id;
   update public.bite_stays set room_id=room.id where id=stay.id;
  elsif p_action='extend' then
   if stay.status not in ('reserved','in_house') then raise exception 'Stay cannot be extended'; end if;
   v_departure:=(p_payload->>'departure')::date; n:=v_departure-stay.departure;
   if n<=0 or v_departure-stay.arrival>365 then raise exception 'Choose a later departure date'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=stay.room_id and s.id<>stay.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.departure,v_departure,'[)')) then raise exception 'Extension conflicts with another reservation'; end if;
   amount:=stay.nightly_rate*n;
   if stay.status='in_house' and amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by) values(p_property,folio.id,'charge','room',n||' extra nights',amount,round(amount*stay.room_tax_rate/100,2),auth.uid()); end if;
   update public.bite_stays set departure=v_departure where id=stay.id;
  else
   if stay.status<>'reserved' then raise exception 'Only an unarrived reservation can be cancelled/no-show'; end if;
   total:=private.bite_folio_totals(folio.id);
   if (total->>'paid')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 or (total->>'balance')::numeric<>0 then raise exception 'Resolve advance, deposit and balance before cancellation'; end if;
   update public.bite_stays set status=case when p_action='cancel' then 'cancelled' else 'no_show' end where id=stay.id;
   update public.bite_folios set status='settled',settled_at=now() where id=folio.id;
  end if;
  folio_id:=folio.id;
 else
  folio_id:=(p_payload->>'folio_id')::uuid;
  select * into strict folio from public.bite_folios where id=folio_id and property_id=p_property;
  select * into strict stay from public.bite_stays where id=folio.stay_id and property_id=p_property;
  if folio.status='settled' then
   if p_action='checkout' then return jsonb_build_object('id',stay.id,'folio_id',folio.id,'already_complete',true,'invoice',folio.invoice_snapshot); end if;
   raise exception 'Settled folio is immutable';
  end if;
  total:=private.bite_folio_totals(folio.id);
  amount:=round((p_payload->>'amount')::numeric,2); desc_text:=left(trim(coalesce(p_payload->>'description','')),250);
  if p_action='checkout' then
   if stay.status<>'in_house' then raise exception 'Only an in-house stay can check out'; end if;
   if (total->>'balance')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;
   invoice:=jsonb_build_object('number','BITE-'||replace(folio.id::text,'-',''),'issued_at',now(),'property',jsonb_build_object('name',prop.name,'address',prop.address,'phone',prop.phone),'tax_profile',prop.tax_profile,
    'guest',(select jsonb_build_object('name',full_name,'address',address) from public.bite_guests where id=stay.guest_id),'stay',to_jsonb(stay),'totals',total,
    'entries',(select coalesce(jsonb_agg(to_jsonb(e)-'created_by' order by e.created_at),'[]'::jsonb) from public.bite_folio_entries e where e.folio_id=folio.id));
   update public.bite_folios set status='settled',settled_at=now(),invoice_number=invoice->>'number',invoice_snapshot=invoice where id=folio.id;
   update public.bite_stays set status='checked_out',checked_out_at=now() where id=stay.id;
   update public.bite_rooms set housekeeping='dirty' where id=stay.room_id;
   entity:=stay.id; result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'invoice',invoice);
  elsif p_action='payment_confirm' then
   select * into strict entry from public.bite_folio_entries where id=entity and folio_id=folio.id and property_id=p_property;
   if entry.kind not in ('payment','deposit_hold') or entry.status<>'pending' then raise exception 'Only pending payments or deposits can be confirmed'; end if;
   if entry.kind='payment' and entry.amount>(total->>'balance')::numeric then raise exception 'Payment exceeds current balance'; end if;
   if length(trim(coalesce(p_payload->>'reference','')))=0 then raise exception 'Verified bank/provider reference required'; end if;
   update public.bite_folio_entries set status='confirmed',reference=left(p_payload->>'reference',100) where id=entry.id;
  elsif p_action in ('room_post','room_pos') then
   if stay.status<>'in_house' then raise exception 'Select an occupied guest stay'; end if;
   if p_action='room_pos' then
    rid:=(p_payload->>'restaurant_id')::uuid;
    if not private.bite_can(p_property,'restaurant_pos') or not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized property POS outlet required' using errcode='42501'; end if;
    -- Reuse the existing POS engine. The whole sale + folio posting is one
    -- transaction, no restaurant cash receipt and no duplicate Khata debtor.
    order_id:=public.create_pos_order_with_payment(rid,'POS-ROOM-'||p_request::text,'POS - Counter',
     (select full_name from public.bite_guests where id=stay.guest_id),'',p_payload->'items',0,null,current_date,null,null);
   else order_id:=(p_payload->>'order_id')::uuid; end if;
   select * into strict ord from public.orders where id=order_id for update;
   if not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=ord.restaurant_id) or not public.has_restaurant_role(ord.restaurant_id,array['owner','manager','staff']) then raise exception 'Order belongs to another property/outlet' using errcode='42501'; end if;
   if ord.channel not like 'POS - %' or ord.status in ('Cancelled','Rejected') or ord.is_demo then raise exception 'Only genuine POS sales can be charged to room'; end if;
   if ord.restaurant_customer_id is not null or ord.waived_off_amount<>0 or exists(select 1 from public.restaurant_order_payments where order_id=ord.id) or exists(select 1 from public.restaurant_order_refunds where order_id=ord.id) then raise exception 'Paid, Khata-linked, adjusted or refunded POS sale cannot be posted'; end if;
   if exists(select 1 from public.bite_folio_entries where source_order_id=ord.id) then raise exception 'POS sale already posted to a folio'; end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,source_order_id,created_by)
   values(p_property,folio.id,'charge','food','POS '||ord.order_code,ord.amount,ord.id,auth.uid()) returning id into entity;
   if p_action='room_pos' then result:=jsonb_build_object('id',ord.id,'order_id',ord.id,'entry_id',entity,'folio_id',folio.id,'confirmed',true); end if;
  elsif p_action='reverse' then
   select * into strict entry from public.bite_folio_entries where id=entity and folio_id=folio.id and property_id=p_property and kind='charge' and status='confirmed';
   if desc_text='' then raise exception 'Reversal reason required'; end if;
   if entry.source_order_id is not null then
    if not private.bite_can(p_property,'charge_to_room') then raise exception 'Room charge correction permission required' using errcode='42501'; end if;
    select * into strict ord from public.orders where id=entry.source_order_id for update;
    if not public.has_restaurant_role(ord.restaurant_id,array['owner','manager']) then raise exception 'Restaurant manager permission required' using errcode='42501'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,reversal_of,created_by)
   values(p_property,folio.id,'reversal',entry.category,desc_text,entry.amount,entry.tax_amount,entry.id,auth.uid()) returning id into entity;
   if entry.source_order_id is not null then
    -- The trigger below permits only this coordinated cancellation, once the
    -- immutable matching reversal exists in the same transaction.
    update public.orders set status='Cancelled' where id=entry.source_order_id;
   end if;
  elsif p_action in ('charge','discount','payment','refund','deposit_hold','deposit_return','deposit_apply') then
   if amount is null or amount<=0 or (p_payload->>'amount')::numeric<>amount then raise exception 'Positive amount with maximum two decimals required'; end if;
   if desc_text='' then raise exception 'Description or reason required'; end if;
   kind:=p_action; tax:=0; stat:='confirmed';
   if p_action='charge' then
    if stay.status<>'in_house' or not private.bite_can(p_property,'hotel_incidentals') then raise exception 'Active stay and incidentals permission required'; end if;
    rate:=case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.tax_profile->>'incidental_rate')::numeric,0) else 0 end;
    tax:=round(amount*rate/100,2);
   elsif p_action in ('payment','deposit_hold') then
    if p_payload->>'method' not in ('Cash','UPI','Card','Bank Transfer','Other') then raise exception 'Select collection method'; end if;
    stat:=case when p_payload->>'method' in ('UPI','Card','Bank Transfer') then 'pending' else 'confirmed' end;
    if p_action='payment' and amount>(total->>'balance')::numeric then raise exception 'Payment exceeds outstanding balance'; end if;
   elsif p_action in ('deposit_return','deposit_apply') then
    if amount>(total->>'deposit_held')::numeric then raise exception 'Amount exceeds held deposit'; end if;
    if p_action='deposit_apply' and amount>(total->>'balance')::numeric then raise exception 'Applied deposit exceeds balance'; end if;
   elsif p_action='discount' then
    if amount>(total->>'balance')::numeric then raise exception 'Discount exceeds outstanding balance'; end if;
   elsif p_action='refund' then
    if amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Only existing overpayment/credit can be recorded as refunded'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,status,method,reference,created_by)
   values(p_property,folio.id,kind,case when kind in ('deposit_hold','deposit_return','deposit_apply') then 'deposit' when kind in ('payment','refund') then 'payment' else 'incidental' end,desc_text,amount,tax,stat,p_payload->>'method',left(coalesce(p_payload->>'reference',''),100),auth.uid()) returning id into entity;
  else raise exception 'Unknown property action'; end if;
 end if;
 result:=coalesce(result,jsonb_build_object('id',entity,'folio_id',folio_id,'confirmed',true));
 insert into public.bite_property_commands values(p_property,p_request,p_action,p_payload,result,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),p_action,entity,p_request);
 return result;
end $$;
create function public.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.bite_property_command(p_property,p_action,p_payload,p_request)$$;

create function private.bite_hotel_workspace(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 if not private.bite_can(p_property,'membership') then raise exception 'Property access denied' using errcode='42501'; end if;
 result:=jsonb_build_object('rooms','[]'::jsonb,'guests','[]'::jsonb,'stays','[]'::jsonb,'folios','[]'::jsonb,'entries','[]'::jsonb,'audit','[]'::jsonb);
 if private.bite_can(p_property,'hotel_rooms') then result:=result||jsonb_build_object('rooms',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('occupied',exists(select 1 from public.bite_stays s where s.room_id=r.id and s.status='in_house')) order by r.number),'[]'::jsonb) from public.bite_rooms r where property_id=p_property)); end if;
 if private.bite_can(p_property,'manage_modules') then result:=result||jsonb_build_object('members',(select coalesce(jsonb_agg(m),'[]'::jsonb) from public.bite_property_members m where property_id=p_property)); end if;
 if private.bite_can(p_property,'expenses') then result:=result||jsonb_build_object('expenses',(select coalesce(jsonb_agg(e order by e.expense_date desc),'[]'::jsonb) from public.bite_property_expenses e where property_id=p_property)); end if;
 if private.bite_can(p_property,'guest_register') then result:=result||jsonb_build_object('guests',(select coalesce(jsonb_agg(g order by g.created_at desc),'[]'::jsonb) from public.bite_guests g where property_id=p_property)); end if;
 if private.bite_can(p_property,'reservations') then result:=result||jsonb_build_object('stays',(select coalesce(jsonb_agg(s order by s.created_at desc),'[]'::jsonb) from public.bite_stays s where property_id=p_property)); end if;
 if private.bite_can(p_property,'folios') then result:=result||jsonb_build_object('folios',(select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('totals',private.bite_folio_totals(f.id))),'[]'::jsonb) from public.bite_folios f where property_id=p_property),
 'entries',(select coalesce(jsonb_agg(e order by e.created_at),'[]'::jsonb) from public.bite_folio_entries e where property_id=p_property)); end if;
 if private.bite_can(p_property,'reporting') then result:=result||jsonb_build_object('audit',(select coalesce(jsonb_agg(a),'[]'::jsonb) from (select id,action,entity_id,created_at from public.bite_property_audit where property_id=p_property order by id desc limit 100) a)); end if;
 return result;
end $$;
create function public.bite_hotel_workspace(p_property uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bite_hotel_workspace(p_property)$$;

-- Minimal stay picker for cashier: no phone, ID, address, payment or ledger data.
create function private.bite_room_charge_targets(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.bite_can(p_property,'charge_to_room') then raise exception 'Room charge access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('folio_id',f.id,'stay_id',s.id,'room',r.number,'guest',g.full_name))
 from public.bite_stays s join public.bite_folios f on f.stay_id=s.id join public.bite_rooms r on r.id=s.room_id join public.bite_guests g on g.id=s.guest_id
 where s.property_id=p_property and s.status='in_house' and f.status='open'),'[]'::jsonb);
end $$;
create function public.bite_room_charge_targets(p_property uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bite_room_charge_targets(p_property)$$;

-- Guard existing POS collections/corrections after a transfer to hotel folio.
-- The original POS sale remains the single food revenue record. Collection is
-- owned by the folio, so direct POS receipt entry must fail even via REST/RPC.
create function private.bite_guard_room_posted_pos() returns trigger language plpgsql security definer set search_path='' as $$declare target uuid; begin
 if TG_TABLE_NAME='orders' then target:=old.id; elsif TG_OP='DELETE' then target:=old.order_id; else target:=new.order_id; end if;
 -- Serializes against a concurrent folio transfer, even on legacy REST writes.
 perform 1 from public.orders where id=target for update;
 if exists(select 1 from public.bite_folio_entries e where e.source_order_id=target) then
  if TG_TABLE_NAME='orders' then
   if new.status='Cancelled' and new.amount=old.amount and new.waived_off_amount=old.waived_off_amount and exists(
    select 1 from public.bite_folio_entries e join public.bite_folio_entries r on r.reversal_of=e.id
    where e.source_order_id=target and r.kind='reversal' and r.amount=e.amount and r.tax_amount=e.tax_amount) then return new; end if;
  end if;
  raise exception 'POS sale charged to room. Collect or correct through its hotel folio.';
 end if;
 if TG_OP='DELETE' then return old; end if;return new;
end $$;
create trigger bite_room_posted_payment_guard before insert or update or delete on public.restaurant_order_payments for each row execute function private.bite_guard_room_posted_pos();
create trigger bite_room_posted_order_guard before update of amount,waived_off_amount,status on public.orders for each row when (old.channel like 'POS - %') execute function private.bite_guard_room_posted_pos();
create trigger bite_room_posted_refund_guard before insert or update or delete on public.restaurant_order_refunds for each row execute function private.bite_guard_room_posted_pos();
create trigger bite_room_posted_item_guard before insert or update or delete on public.order_items for each row execute function private.bite_guard_room_posted_pos();

-- Module hiding must not be the authorization boundary. These guards also run
-- for existing privileged RPCs, including direct REST calls to legacy routines.
create function private.bite_outlet_enabled(p_restaurant uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select p_capability=any(p.capabilities) from public.bite_property_outlets o
  join public.bite_properties p on p.id=o.property_id where o.restaurant_id=p_restaurant),true)
$$;
create function private.bite_guard_outlet_module() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;cap text;begin
 if TG_OP='DELETE' then rid:=old.restaurant_id;else rid:=new.restaurant_id;end if;
 if TG_TABLE_NAME='orders' then
  cap:=case when new.channel like 'POS - %' then 'restaurant_pos' else 'online_food_orders' end;
 elsif TG_TABLE_NAME='bite_live_checkout_intents' then cap:='online_food_orders';
 else cap:='restaurant_menu';end if;
 if not private.bite_outlet_enabled(rid,cap) then raise exception 'Business module disabled for this outlet' using errcode='42501';end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger bite_order_module_guard before insert on public.orders for each row execute function private.bite_guard_outlet_module();
-- Stop before Cashfree session creation, not just after a payment at activation.
create trigger bite_checkout_module_guard before insert on public.bite_live_checkout_intents for each row execute function private.bite_guard_outlet_module();
create trigger bite_menu_module_guard before insert or update or delete on public.menu_items for each row execute function private.bite_guard_outlet_module();
create trigger bite_category_module_guard before insert or update or delete on public.menu_categories for each row execute function private.bite_guard_outlet_module();
-- Deliberately public boolean metadata used by RLS. No rows, guest data or
-- private-schema grants are exposed to anonymous clients.
create function public.bite_outlet_module_enabled(p_restaurant uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_capability in ('restaurant_menu','online_food_orders','restaurant_pos') then private.bite_outlet_enabled(p_restaurant,p_capability) else false end
$$;
create policy bite_menu_module_read on public.menu_items as restrictive for select to authenticated,anon using(public.bite_outlet_module_enabled(restaurant_id,'restaurant_menu'));
create policy bite_category_module_read on public.menu_categories as restrictive for select to authenticated,anon using(public.bite_outlet_module_enabled(restaurant_id,'restaurant_menu'));

revoke all on function private.bite_default_capabilities(text),private.bite_property_role(uuid),private.bite_can(uuid,text),private.bite_folio_totals(uuid),private.bite_owner_context(),private.bite_create_property(text,text,uuid),private.bite_property_command(uuid,text,jsonb,uuid),private.bite_hotel_workspace(uuid),private.bite_room_charge_targets(uuid),private.bite_guard_room_posted_pos() from public,anon;
revoke all on function private.bite_outlet_enabled(uuid,text),private.bite_guard_outlet_module() from public,anon;
grant usage on schema private to authenticated;
revoke all on function public.bite_outlet_module_enabled(uuid,text) from public;
grant execute on function public.bite_outlet_module_enabled(uuid,text) to authenticated,anon;
grant execute on function private.bite_property_role(uuid),private.bite_can(uuid,text),private.bite_owner_context(),private.bite_create_property(text,text,uuid),private.bite_property_command(uuid,text,jsonb,uuid),private.bite_hotel_workspace(uuid),private.bite_room_charge_targets(uuid) to authenticated;
revoke all on function public.bite_owner_context(),public.bite_create_property(text,text,uuid),public.bite_property_command(uuid,text,jsonb,uuid),public.bite_hotel_workspace(uuid),public.bite_room_charge_targets(uuid) from public,anon;
grant execute on function public.bite_owner_context(),public.bite_create_property(text,text,uuid),public.bite_property_command(uuid,text,jsonb,uuid),public.bite_hotel_workspace(uuid),public.bite_room_charge_targets(uuid) to authenticated;
