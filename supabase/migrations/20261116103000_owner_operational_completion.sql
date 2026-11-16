-- Owner operational completion. Existing ledger entries and invoices are retained.
alter table public.bite_rooms add column do_not_disturb boolean not null default false;
alter table public.bite_rooms add column cleaning_requested boolean not null default false;
alter table public.bite_folios add column payer_split jsonb;
create table public.bite_cashier_outlet_grants (
 property_id uuid not null references public.bite_properties(id), user_id uuid not null references auth.users(id),
 restaurant_id uuid not null references public.restaurants(id), primary key(property_id,user_id,restaurant_id)
);
alter table public.bite_cashier_outlet_grants enable row level security;
revoke all on public.bite_cashier_outlet_grants from public,anon,authenticated;
create table public.bite_property_shift_closings (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.bite_properties(id),
 shift_date date not null,opening_cash numeric(14,2) not null check(opening_cash>=0),
 counted_cash numeric(14,2) not null check(counted_cash>=0),expected_cash numeric(14,2) not null,
 difference numeric(14,2) not null,notes text not null default '',snapshot jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(property_id,shift_date)
);
alter table public.bite_property_shift_closings enable row level security;
revoke all on public.bite_property_shift_closings from public,anon,authenticated;
grant select on public.bite_property_shift_closings to authenticated;
create policy property_shift_read on public.bite_property_shift_closings for select to authenticated
 using(private.bite_can(property_id,'reporting'));

-- Itemized payer statements partition each confirmed charge in paise. Receipts
-- remain on the ONE folio; allocations do not pretend to be separate collections.
create function private.bite_split_invoice(p_invoice jsonb,p_split jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare e jsonb; a jsonb:='[]';b jsonb:='[]';pct numeric;net numeric;first numeric;second numeric;ca numeric:=0;cb numeric:=0;sign numeric;
begin
 if p_split is null then return '[]'::jsonb;end if;
 pct:=(p_split->>'first_percent')::numeric;
 for e in select value from jsonb_array_elements(p_invoice->'entries') where value->>'status'='confirmed' and value->>'kind' in ('charge','discount','reversal') loop
  net:=(e->>'amount')::numeric+coalesce((e->>'tax_amount')::numeric,0);first:=round(net*pct/100,2);second:=net-first;
  sign:=case when e->>'kind'='charge' then 1 else -1 end;ca:=ca+sign*first;cb:=cb+sign*second;
  a:=a||jsonb_build_array(e||jsonb_build_object('amount',first,'tax_amount',0,'allocated_inclusive_of_tax',true));
  b:=b||jsonb_build_array(e||jsonb_build_object('amount',second,'tax_amount',0,'allocated_inclusive_of_tax',true));
 end loop;
 return jsonb_build_array(
  (p_invoice-'entries'-'totals')||jsonb_build_object('number',(p_invoice->>'number')||'-A','guest',jsonb_build_object('name',p_split->>'first_name'),'entries',a,'totals',jsonb_build_object('charges',ca,'paid',ca,'balance',0,'deposit_held',0),'allocation_note','Share of itemized charges including tax. Paid from the shared settled folio; not a separate payer receipt.'),
  (p_invoice-'entries'-'totals')||jsonb_build_object('number',(p_invoice->>'number')||'-B','guest',jsonb_build_object('name',p_split->>'second_name'),'entries',b,'totals',jsonb_build_object('charges',cb,'paid',cb,'balance',0,'deposit_held',0),'allocation_note','Share of itemized charges including tax. Paid from the shared settled folio; not a separate payer receipt.')
 );
end $$;

create function private.bite_property_report(p_property uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;room_total numeric;extra_total numeric;food_total numeric;cash_total numeric;source_hash text;
begin
 if not private.bite_can(p_property,'reporting') then raise exception 'Reporting access denied' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Choose up to 367 report days';end if;
 select coalesce(sum(case when category='room' then (case when kind='charge' then 1 else -1 end)*(amount+tax_amount) else 0 end),0),
 coalesce(sum(case when category='incidental' then (case when kind='charge' then 1 else -1 end)*(amount+tax_amount) else 0 end),0)
 into room_total,extra_total from public.bite_folio_entries where property_id=p_property and status='confirmed' and kind in ('charge','discount','reversal') and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
 select coalesce(sum(o.amount-o.waived_off_amount),0) into food_total from public.orders o join public.bite_property_outlets po on po.restaurant_id=o.restaurant_id
 where po.property_id=p_property and not o.is_demo and o.status not in ('Cancelled','Rejected') and (o.order_date at time zone 'Asia/Kolkata')::date between p_from and p_to and (o.channel !~* 'own platform|website|^web$' or exists(select 1 from public.order_financials f where f.order_id=o.id and f.payment_status='paid'));
 -- Cashbook already contains canonical POS receipts/refunds/restaurant expenses.
 -- Room food transfers have no POS receipt. Add hotel receipts/deposits once.
 with money as (
 select c.entry_id::text id,c.direction,c.amount,c.payment_method from public.restaurant_cashbook_entries c join public.bite_property_outlets o on o.restaurant_id=c.restaurant_id where o.property_id=p_property and c.entry_date between p_from and p_to
 union all select e.id::text,case when e.kind in ('refund','deposit_return') then 'out' else 'in' end,e.amount,coalesce(e.method,'Other') from public.bite_folio_entries e where e.property_id=p_property and e.status='confirmed' and e.kind in ('payment','advance','refund','deposit_hold','deposit_return') and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
 union all select e.id::text,'out',e.amount,e.method from public.bite_property_expenses e where e.property_id=p_property and e.expense_date between p_from and p_to
 ) select coalesce(sum(case when direction='in' then amount else -amount end) filter(where payment_method='Cash'),0),md5(coalesce(string_agg(id||direction||amount||payment_method,'|' order by id),'')),
 jsonb_build_object('methods',coalesce((select jsonb_agg(m) from (select payment_method,sum(case when direction='in' then amount else -amount end) net from money group by payment_method) m),'[]'::jsonb),'money_entries',count(*)) into cash_total,source_hash,v from money;
 return v||jsonb_build_object('room_revenue',room_total,'incidentals_revenue',extra_total,'food_revenue',food_total,'total_revenue',room_total+extra_total+food_total,'cash_movement',cash_total,'source_hash',source_hash,'from',p_from,'to',p_to,
 'closings',(select coalesce(jsonb_agg(c order by c.shift_date desc),'[]'::jsonb) from public.bite_property_shift_closings c where c.property_id=p_property and c.shift_date between p_from and p_to));
end $$;
create function public.bite_property_report(p_property uuid,p_from date,p_to date) returns jsonb language sql security invoker set search_path='' as $$select private.bite_property_report(p_property,p_from,p_to)$$;
create function private.bite_audit_search(p_property uuid,p_query text,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.bite_can(p_property,'reporting') then raise exception 'Audit access denied' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,action,entity_id,actor_id,created_at from public.bite_property_audit where property_id=p_property and (p_before is null or id<p_before) and (coalesce(p_query,'')='' or action ilike '%'||left(p_query,100)||'%' or entity_id::text ilike '%'||left(p_query,100)||'%') order by id desc limit 100) x);
end $$;
create function public.bite_audit_search(p_property uuid,p_query text,p_before bigint default null) returns jsonb language sql security invoker set search_path='' as $$select private.bite_audit_search(p_property,p_query,p_before)$$;
revoke all on function private.bite_split_invoice(jsonb,jsonb),private.bite_property_report(uuid,date,date),private.bite_audit_search(uuid,text,bigint),public.bite_property_report(uuid,date,date),public.bite_audit_search(uuid,text,bigint) from public,anon;
grant execute on function private.bite_property_report(uuid,date,date),private.bite_audit_search(uuid,text,bigint),public.bite_property_report(uuid,date,date),public.bite_audit_search(uuid,text,bigint) to authenticated;
-- Cashiers retain the same safe per-user/per-outlet draft storage as owners.
create policy property_staff_draft_select on public.restaurant_pos_drafts for select to authenticated using(created_by=(select auth.uid()) and exists(select 1 from public.bite_property_outlets o where o.restaurant_id=restaurant_pos_drafts.restaurant_id and private.bite_can(o.property_id,'restaurant_pos')));
create policy property_staff_draft_insert on public.restaurant_pos_drafts for insert to authenticated with check(created_by=(select auth.uid()) and exists(select 1 from public.bite_property_outlets o where o.restaurant_id=restaurant_pos_drafts.restaurant_id and private.bite_can(o.property_id,'restaurant_pos')));
create policy property_staff_draft_update on public.restaurant_pos_drafts for update to authenticated using(created_by=(select auth.uid()) and exists(select 1 from public.bite_property_outlets o where o.restaurant_id=restaurant_pos_drafts.restaurant_id and private.bite_can(o.property_id,'restaurant_pos'))) with check(created_by=(select auth.uid()) and exists(select 1 from public.bite_property_outlets o where o.restaurant_id=restaurant_pos_drafts.restaurant_id and private.bite_can(o.property_id,'restaurant_pos')));
create policy property_staff_draft_delete on public.restaurant_pos_drafts for delete to authenticated using(created_by=(select auth.uid()) and exists(select 1 from public.bite_property_outlets o where o.restaurant_id=restaurant_pos_drafts.restaurant_id and private.bite_can(o.property_id,'restaurant_pos')));

create or replace function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 prop public.bite_properties; prior public.bite_property_commands;
 room public.bite_rooms; stay public.bite_stays; folio public.bite_folios; entry public.bite_folio_entries;
 caps text[]; cap text; role_name text; entity uuid; guest uuid; room_id uuid; folio_id uuid;
 v_expected_cash numeric(14,2);v_extension_rate numeric(14,2);amount numeric(14,2); tax numeric(14,2); rate numeric(6,3); total jsonb; result jsonb;
 v_arrival date; v_departure date; n integer; a integer; c integer; old_room uuid; kind text; stat text; desc_text text;
 invoice jsonb; rid uuid; order_id uuid; ord public.orders; unit jsonb;v_group uuid;group_stays jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Authenticated request ID and payload required' using errcode='42501'; end if;
 role_name:=private.bite_property_role(p_property);
 if role_name is null then raise exception 'Property access denied' using errcode='42501'; end if;
 cap:=case
  when p_action in ('config','member') then 'manage_modules'
  when p_action in ('room_save','room_status','room_privacy') then 'housekeeping'
  when p_action='guest_save' then 'guest_register'
  when p_action in ('reserve','reserve_group','reservation_edit','checkin','move','extend','cancel','no_show') then 'reservations'
  when p_action in ('room_post','room_pos') then 'charge_to_room'
  when p_action='pos_sale' then 'restaurant_pos'
  when p_action='close_shift' then 'reporting'
  when p_action='expense' then 'expenses'
  else 'folios' end;
 if not private.bite_can(p_property,cap) then raise exception 'Module or role does not permit this action' using errcode='42501'; end if;
 if role_name='accountant' then raise exception 'Read-only accounting access' using errcode='42501'; end if;
 if p_action in ('room_save','discount','reverse','refund','payment_confirm','payment_void','expense','split_bill','close_shift') and role_name not in ('owner','manager') then raise exception 'Owner or manager authorization required' using errcode='42501'; end if;
 -- One property's writes serialize: allocation, ledger writes, config disable and
 -- checkout cannot race. No locks on unrelated restaurant/payment workflows.
 select * into strict prop from public.bite_properties where id=p_property for update;
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details'; end if;
  return prior.result;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;

 if p_action in ('room_pos','pos_sale') then
  if coalesce(jsonb_typeof(p_payload->'items'),'')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 200 then raise exception 'Add 1 to 200 valid POS items';end if;
  for unit in select value from jsonb_array_elements(p_payload->'items') loop
   if length(trim(coalesce(unit->>'name',''))) not between 1 and 120 or (unit->>'quantity')::numeric is null or (unit->>'quantity')::numeric not between 0.01 and 9999 or (unit->>'quantity')::numeric<>round((unit->>'quantity')::numeric,2) or (unit->>'unit_price')::numeric is null or (unit->>'unit_price')::numeric not between 0 and 9999999999.99 or (unit->>'unit_price')::numeric<>round((unit->>'unit_price')::numeric,2) then raise exception 'POS item quantity and price must be finite positive/two-decimal amounts';end if;
  end loop;
 end if;
 if p_action='config' then
  select coalesce(array_agg(value),'{}'::text[]) into caps from jsonb_array_elements_text(p_payload->'capabilities');
  if caps is null or not caps <@ private.bite_default_capabilities('hybrid') then raise exception 'Unknown business module'; end if;
  if p_payload->>'business_type' not in ('restaurant','hotel','hybrid') then raise exception 'Choose a valid business type'; end if;
  if p_payload->>'business_type' in ('hotel','hybrid') and not 'hotel_rooms'=any(caps) then raise exception 'Hotel business type requires the hotel module bundle'; end if;
  if p_payload->>'business_type' in ('restaurant','hybrid') and not 'restaurant_menu'=any(caps) then raise exception 'Restaurant business type requires its menu module'; end if;
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
   where o.property_id=p_property and not r.is_demo
   and (not 'restaurant_menu'=any(caps) or (not 'restaurant_pos'=any(caps) and r.channel like 'POS - %') or (not 'online_food_orders'=any(caps) and r.channel not like 'POS - %'))
   and (r.status in ('Received','Accepted','Preparing','Ready','Handed Over') or exists(select 1 from public.bite_refund_jobs j where j.order_id=r.id and j.status not in ('succeeded','cancelled')))) then raise exception 'Resolve active orders/refunds before disabling food modules'; end if;
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
 elsif p_action='close_shift' then
  v_arrival:=(p_payload->>'shift_date')::date;
  if v_arrival>(now() at time zone prop.timezone)::date then raise exception 'Cannot close a future shift';end if;
  if exists(select 1 from public.bite_property_shift_closings where property_id=p_property and shift_date=v_arrival) then raise exception 'Shift already closed; review its immutable snapshot';end if;
  total:=private.bite_property_report(p_property,v_arrival,v_arrival);
  if p_payload->>'source_hash' is distinct from total->>'source_hash' then raise exception 'Money entries changed. Refresh and review before closing';end if;
  amount:=(p_payload->>'opening_cash')::numeric;tax:=(p_payload->>'counted_cash')::numeric;
  if amount is null or tax is null or amount not between 0 and 999999999999.99 or tax not between 0 and 999999999999.99 or amount<>round(amount,2) or tax<>round(tax,2) then raise exception 'Valid opening and counted cash required';end if;
  v_expected_cash:=amount+(total->>'cash_movement')::numeric;
  if v_expected_cash not between 0 and 999999999999.99 then raise exception 'Opening cash is insufficient for recorded cash outflows';end if;
  desc_text:=left(trim(coalesce(p_payload->>'notes','')),500);
  if tax<>v_expected_cash and length(desc_text)<8 then raise exception 'Explain the cash difference (at least 8 characters)';end if;
  insert into public.bite_property_shift_closings(property_id,shift_date,opening_cash,counted_cash,expected_cash,difference,notes,snapshot,created_by)
  values(p_property,v_arrival,amount,tax,v_expected_cash,tax-v_expected_cash,desc_text,total,auth.uid()) returning id into entity;
 elsif p_action='pos_sale' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not exists(select 1 from public.bite_property_outlets where property_id=p_property and restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized POS outlet required' using errcode='42501';end if;
  if p_payload->>'channel' not in ('POS - Counter','POS - Dine-in','POS - Takeaway') then raise exception 'Select a POS order type';end if;
  select sum(round((value->>'quantity')::numeric*(value->>'unit_price')::numeric,2)) into amount from jsonb_array_elements(p_payload->'items');
  if (p_payload->>'paid_amount')::numeric is distinct from amount then raise exception 'Dine-in, takeaway and cashier Pay Now bills require full recorded payment. Use room billing for an occupied guest';end if;
  entity:=public.create_pos_order_with_payment(rid,'POS-'||p_request::text,p_payload->>'channel',left(p_payload->>'customer_name',120),left(p_payload->>'customer_phone',20),p_payload->'items',amount,p_payload->>'payment_method',(now() at time zone prop.timezone)::date,p_payload->>'reference',nullif(p_payload->>'table_id','')::uuid);
  result:=jsonb_build_object('id',entity,'order_id',entity,'confirmed',true);
 elsif p_action='expense' then
  if (p_payload->>'amount')::numeric<>round((p_payload->>'amount')::numeric,2) then raise exception 'Maximum two decimal places'; end if;
  insert into public.bite_property_expenses(property_id,description,amount,expense_date,method,created_by)
  values(p_property,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'expense_date')::date,p_payload->>'method',auth.uid()) returning id into entity;
 elsif p_action='member' then
  if entity is null then
   if (select count(*) from auth.users u where lower(u.email)=lower(trim(p_payload->>'email')))<>1 then raise exception 'Exactly one registered staff account must match this email'; end if;
   select u.id into entity from auth.users u where lower(u.email)=lower(trim(p_payload->>'email'));
  end if;
  if p_payload->>'role' not in ('manager','receptionist','cashier','housekeeping','accountant') then raise exception 'Choose a permitted staff role'; end if;
  if entity=(select owner_id from public.bite_businesses where id=prop.business_id) or exists(select 1 from public.platform_admins where user_id=entity) then raise exception 'Cannot reassign property owner or platform admin'; end if;
  if not exists(select 1 from auth.users where id=entity) then raise exception 'Registered user ID required'; end if;
  insert into public.bite_property_members values(p_property,entity,p_payload->>'role',coalesce((p_payload->>'active')::boolean,true))
   on conflict(property_id,user_id) do update set role=excluded.role,active=excluded.active;
 -- Link only explicitly assigned cashiers/managers to this owner's outlets.
  -- Existing independent memberships are never overwritten or removed.
  for rid in select restaurant_id from public.bite_property_outlets where property_id=p_property loop
   if not public.has_restaurant_role(rid,array['owner']) then raise exception 'Only the linked outlet owner may grant restaurant access' using errcode='42501';end if;
   if p_payload->>'role' in ('cashier','manager') and coalesce((p_payload->>'active')::boolean,true) then
    if not exists(select 1 from public.restaurant_members where restaurant_id=rid and user_id=entity) then
     insert into public.restaurant_members(restaurant_id,user_id,role) values(rid,entity,case when p_payload->>'role'='manager' then 'manager' else 'staff' end);
     insert into public.bite_cashier_outlet_grants(property_id,user_id,restaurant_id) values(p_property,entity,rid);
    end if;
   else
    delete from public.restaurant_members m where m.restaurant_id=rid and m.user_id=entity and m.role in ('staff','manager') and exists(select 1 from public.bite_cashier_outlet_grants g where g.property_id=p_property and g.restaurant_id=rid and g.user_id=entity);
    delete from public.bite_cashier_outlet_grants where property_id=p_property and restaurant_id=rid and user_id=entity;
   end if;
  end loop;
 elsif p_action='room_save' then
  if entity is null then
   insert into public.bite_rooms(property_id,number,room_type,floor,nightly_rate,adults,children)
   values(p_property,trim(p_payload->>'number'),trim(p_payload->>'room_type'),left(coalesce(p_payload->>'floor',''),30),(p_payload->>'nightly_rate')::numeric,(p_payload->>'adults')::integer,coalesce((p_payload->>'children')::integer,0)) returning id into entity;
  else
   select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
   if exists(select 1 from public.bite_stays where room_id=entity and status in ('reserved','in_house')) and not coalesce((p_payload->>'active')::boolean,true) then raise exception 'Room has active or reserved stays'; end if;
   update public.bite_rooms set number=trim(p_payload->>'number'),room_type=trim(p_payload->>'room_type'),floor=left(coalesce(p_payload->>'floor',''),30),nightly_rate=(p_payload->>'nightly_rate')::numeric,adults=(p_payload->>'adults')::integer,children=coalesce((p_payload->>'children')::integer,0),active=coalesce((p_payload->>'active')::boolean,true) where id=entity;
  end if;
 elsif p_action='room_privacy' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  if not exists(select 1 from public.bite_stays where room_id=entity and status='in_house') and coalesce((p_payload->>'do_not_disturb')::boolean,false) then raise exception 'Do Not Disturb applies to occupied rooms';end if;
  update public.bite_rooms set do_not_disturb=coalesce((p_payload->>'do_not_disturb')::boolean,false),cleaning_requested=coalesce((p_payload->>'cleaning_requested')::boolean,false),status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='room_status' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  stat:=p_payload->>'status';
  if room.do_not_disturb and stat='cleaning' then raise exception 'Do Not Disturb is active. Confirm permission before starting cleaning';end if;
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
 elsif p_action='reserve_group' then
  if coalesce(jsonb_typeof(p_payload->'rooms'),'')<>'array' or jsonb_array_length(p_payload->'rooms') not between 1 and 50 then raise exception 'Choose 1 to 50 rooms for a group'; end if;
  insert into public.bite_booking_groups(property_id,name,payer_guest_id)
  values(p_property,trim(p_payload->>'name'),(p_payload->>'guest_id')::uuid) returning id into v_group;
  for unit in select value from jsonb_array_elements(p_payload->'rooms') loop
   result:=private.bite_property_command(p_property,'reserve',jsonb_build_object('guest_id',p_payload->>'guest_id','room_id',unit->>'room_id','adults',coalesce(unit->'adults','1'::jsonb),'children',coalesce(unit->'children','0'::jsonb),'arrival',p_payload->>'arrival','departure',p_payload->>'departure','compliance_note',coalesce(p_payload->>'compliance_note','')),gen_random_uuid());
   update public.bite_stays set group_id=v_group where id=(result->>'id')::uuid;
   group_stays:=group_stays||jsonb_build_array(result);
  end loop;
  entity:=v_group;result:=jsonb_build_object('id',v_group,'stays',group_stays,'confirmed',true);
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
 elsif p_action in ('reservation_edit','checkin','move','extend','cancel','no_show') then
  select * into strict stay from public.bite_stays where id=entity and property_id=p_property;
  select * into strict folio from public.bite_folios where stay_id=stay.id and property_id=p_property;
  if folio.status<>'open' then raise exception 'Folio already settled'; end if;
  if p_action='reservation_edit' then
   if stay.status<>'reserved' then raise exception 'Only an unarrived reservation can be corrected'; end if;
   v_arrival:=(p_payload->>'arrival')::date;v_departure:=(p_payload->>'departure')::date;
   room_id:=(p_payload->>'room_id')::uuid;a:=(p_payload->>'adults')::integer;c:=(p_payload->>'children')::integer;
   if v_departure<=v_arrival or v_departure-v_arrival>365 then raise exception 'Choose valid stay dates'; end if;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping<>'blocked';
   if a>room.adults or c>room.children then raise exception 'Room occupancy limit exceeded'; end if;
   if exists(select 1 from public.bite_stays s where s.id<>stay.id and s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(v_arrival,v_departure,'[)')) then raise exception 'Room already reserved for corrected dates'; end if;
   update public.bite_stays set room_id=room.id,arrival=v_arrival,departure=v_departure,adults=a,children=c where id=stay.id;
  elsif p_action='checkin' then
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
   if stay.status not in ('reserved','in_house') then raise exception 'Only an active stay/reservation can move rooms'; end if;
   room_id:=(p_payload->>'room_id')::uuid;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping<>'blocked';
   if stay.status='in_house' and room.housekeeping<>'ready' then raise exception 'Target room must be inspected Ready'; end if;
   if room.id=stay.room_id then raise exception 'Select another room'; end if;
   if room.adults<stay.adults or room.children<stay.children then raise exception 'Room occupancy limit exceeded'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.arrival,stay.departure,'[)')) then raise exception 'Target room has conflicting stay'; end if;
   if stay.status='in_house' then update public.bite_rooms set housekeeping='dirty' where id=stay.room_id; end if;
   update public.bite_stays set room_id=room.id where id=stay.id;
  elsif p_action='extend' then
   if stay.status not in ('reserved','in_house') then raise exception 'Stay cannot be extended'; end if;
   v_departure:=(p_payload->>'departure')::date; n:=v_departure-stay.departure;
   if n<=0 or v_departure-stay.arrival>365 then raise exception 'Choose a later departure date'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=stay.room_id and s.id<>stay.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.departure,v_departure,'[)')) then raise exception 'Extension conflicts with another reservation'; end if;
   amount:=coalesce((p_payload->>'nightly_rate')::numeric,stay.nightly_rate);
   if amount<>stay.nightly_rate and (role_name not in ('owner','manager') or stay.status<>'in_house') then raise exception 'Manager authorization and an in-house stay required for a new extension rate' using errcode='42501';end if;
   if amount<0 or amount<>round(amount,2) then raise exception 'Valid extension rate required';end if;
   v_extension_rate:=amount;amount:=v_extension_rate*n;
   if stay.status='in_house' and amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by) values(p_property,folio.id,'charge','room',n||' extra nights',amount,round(amount*stay.room_tax_rate/100,2),auth.uid()); end if;
   update public.bite_stays set departure=v_departure,nightly_rate=v_extension_rate where id=stay.id;
  else
   if stay.status<>'reserved' then raise exception 'Only an unarrived reservation can be cancelled/no-show'; end if;
   if p_action='no_show' and (stay.arrival>(now() at time zone prop.timezone)::date or (stay.arrival=(now() at time zone prop.timezone)::date and (now() at time zone prop.timezone)::time<prop.checkin_time)) then raise exception 'No-show cannot be marked before the arrival cutoff'; end if;
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
  if p_action='split_bill' then
   if length(trim(coalesce(p_payload->>'first_name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'second_name',''))) not between 1 and 120 or coalesce((p_payload->>'first_percent')::numeric,0) not between 0.01 and 99.99 then raise exception 'Two payer names and a percentage between 0.01 and 99.99 required';end if;
   update public.bite_folios set payer_split=jsonb_build_object('first_name',trim(p_payload->>'first_name'),'second_name',trim(p_payload->>'second_name'),'first_percent',(p_payload->>'first_percent')::numeric) where id=folio.id;
   entity:=folio.id;
  elsif p_action='checkout' then
   if stay.status<>'in_house' then raise exception 'Only an in-house stay can check out'; end if;
   if (total->>'balance')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;
   invoice:=jsonb_build_object('number','BITE-'||replace(folio.id::text,'-',''),'issued_at',now(),'property',jsonb_build_object('name',prop.name,'address',prop.address,'phone',prop.phone),'tax_profile',prop.tax_profile,
    'guest',(select jsonb_build_object('name',full_name,'address',address) from public.bite_guests where id=stay.guest_id),'stay',to_jsonb(stay)||jsonb_build_object('status','checked_out','checked_out_at',now()),'room',(select jsonb_build_object('number',number,'room_type',room_type) from public.bite_rooms where id=stay.room_id),'totals',total,
    'entries',(select coalesce(jsonb_agg((to_jsonb(e)-'created_by')||jsonb_build_object('source_items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.item_name,'quantity',i.quantity,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=e.source_order_id)) order by e.created_at),'[]'::jsonb) from public.bite_folio_entries e where e.folio_id=folio.id));
   invoice:=invoice||jsonb_build_object('splits',private.bite_split_invoice(invoice,folio.payer_split));
   update public.bite_folios set status='settled',settled_at=now(),invoice_number=invoice->>'number',invoice_snapshot=invoice where id=folio.id;
   update public.bite_stays set status='checked_out',checked_out_at=now() where id=stay.id;
   update public.bite_rooms set housekeeping='dirty',do_not_disturb=false,cleaning_requested=false where id=stay.room_id;
   entity:=stay.id; result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'invoice',invoice);
  elsif p_action in ('payment_confirm','payment_void') then
   select * into strict entry from public.bite_folio_entries where id=entity and folio_id=folio.id and property_id=p_property;
   if entry.kind not in ('payment','advance','deposit_hold') or entry.status<>'pending' then raise exception 'Only pending payments or deposits can be verified'; end if;
   if p_action='payment_void' then
    if desc_text='' then raise exception 'Reason for not-received payment required'; end if;
    update public.bite_folio_entries set status='void',reference=left('Not received: '||desc_text,100) where id=entry.id;
   else
   if entry.kind='payment' and entry.amount>(total->>'balance')::numeric then raise exception 'Payment exceeds current balance'; end if;
   if length(trim(coalesce(p_payload->>'reference','')))=0 then raise exception 'Verified bank/provider reference required'; end if;
   update public.bite_folio_entries set status='confirmed',reference=left(p_payload->>'reference',100) where id=entry.id;
   end if;
  elsif p_action in ('room_post','room_pos') then
   if stay.status<>'in_house' then raise exception 'Select an occupied guest stay'; end if;
   if p_action='room_pos' then
    rid:=(p_payload->>'restaurant_id')::uuid;
    if not private.bite_can(p_property,'restaurant_pos') or not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized property POS outlet required' using errcode='42501'; end if;
    -- Reuse the existing POS engine. The whole sale + folio posting is one
    -- transaction, no restaurant cash receipt and no duplicate Khata debtor.
    order_id:=public.create_pos_order_with_payment(rid,'POS-ROOM-'||p_request::text,coalesce(p_payload->>'channel','POS - Counter'),
     (select full_name from public.bite_guests where id=stay.guest_id),'',p_payload->'items',0,null,current_date,null,null);
   amount:=coalesce((p_payload->>'discount')::numeric,0);
    if amount not between 0 and 999999999999.99 or amount<>round(amount,2) then raise exception 'Valid discount required';end if;
    if amount>0 then
     if role_name not in ('owner','manager') or length(trim(coalesce(p_payload->>'discount_reason','')))<3 then raise exception 'Manager approval and discount reason required' using errcode='42501';end if;
     if amount>=(select o.amount from public.orders o where o.id=order_id) then raise exception 'Discount must leave a positive food charge';end if;
     update public.orders set waived_off_amount=(p_payload->>'discount')::numeric where id=order_id;
    end if;
   else order_id:=(p_payload->>'order_id')::uuid; end if;
   select * into strict ord from public.orders where id=order_id for update;
   if not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=ord.restaurant_id) or not public.has_restaurant_role(ord.restaurant_id,array['owner','manager','staff']) then raise exception 'Order belongs to another property/outlet' using errcode='42501'; end if;
   if ord.channel not like 'POS - %' or ord.status in ('Cancelled','Rejected') or ord.is_demo then raise exception 'Only genuine POS sales can be charged to room'; end if;
   if ord.restaurant_customer_id is not null or (ord.waived_off_amount<>0 and p_action<>'room_pos') or exists(select 1 from public.restaurant_order_payments where order_id=ord.id) or exists(select 1 from public.restaurant_order_refunds where order_id=ord.id) then raise exception 'Paid, Khata-linked, adjusted or refunded POS sale cannot be posted'; end if;
   if exists(select 1 from public.bite_folio_entries where source_order_id=ord.id) then raise exception 'POS sale already posted to a folio'; end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,source_order_id,created_by)
   values(p_property,folio.id,'charge','food','POS '||ord.order_code||case when ord.waived_off_amount>0 then ' · discount '||ord.waived_off_amount||': '||left(p_payload->>'discount_reason',60) else '' end,ord.amount-ord.waived_off_amount,ord.id,auth.uid()) returning id into entity;
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
    if p_action='payment' then
     if stay.status='reserved' then
      if amount>round(stay.nightly_rate*(stay.departure-stay.arrival)*(1+stay.room_tax_rate/100),2)-(total->>'paid')::numeric-(total->>'pending')::numeric then raise exception 'Advance exceeds current room quote'; end if;
      kind:='advance';
     elsif amount>(total->>'balance')::numeric then raise exception 'Payment exceeds outstanding balance'; end if;
    end if;
   elsif p_action in ('deposit_return','deposit_apply') then
    if amount>(total->>'deposit_held')::numeric then raise exception 'Amount exceeds held deposit'; end if;
    if p_action='deposit_apply' and amount>(total->>'balance')::numeric then raise exception 'Applied deposit exceeds balance'; end if;
   elsif p_action='discount' then
    if amount>(total->>'balance')::numeric then raise exception 'Discount exceeds outstanding balance'; end if;
   elsif p_action='refund' then
    if amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Only existing overpayment/credit can be recorded as refunded'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,status,method,reference,created_by)
   values(p_property,folio.id,kind,case when kind in ('deposit_hold','deposit_return','deposit_apply') then 'deposit' when kind in ('payment','advance','refund') then 'payment' else 'incidental' end,desc_text,amount,tax,stat,p_payload->>'method',left(coalesce(p_payload->>'reference',''),100),auth.uid()) returning id into entity;
  else raise exception 'Unknown property action'; end if;
 end if;
 result:=coalesce(result,jsonb_build_object('id',entity,'folio_id',folio_id,'confirmed',true));
 insert into public.bite_property_commands values(p_property,p_request,p_action,p_payload,result,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),p_action,entity,p_request);
 return result;
end $$;
