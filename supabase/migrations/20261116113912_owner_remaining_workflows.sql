-- Additive operational workflows. No existing sale, payment or invoice is replaced.
alter table public.bite_properties add column hotel_policy jsonb not null default '{"reviewed":false}';
alter table public.bite_guests add column is_oci boolean not null default false;
alter table public.bite_stays add column policy_snapshot jsonb not null default '{"reviewed":false}';
alter table public.bite_stays add column scheduled_arrival_at timestamptz;
alter table public.bite_stays add column standard_checkout_at timestamptz;
alter table public.bite_stays add column expected_checkout_at timestamptz;
alter table public.bite_stays add column late_fee_waived boolean not null default false;
alter table public.bite_stays add column booking_source text not null default 'walk_in' check(booking_source in ('walk_in','phone','external_booking'));
alter table public.bite_stays add column booking_reference text not null default '' check(length(booking_reference)<=120);
alter table public.bite_folios add column checkout_policy jsonb;
alter table public.bite_folio_entries add column service_from date;
alter table public.bite_folio_entries add column service_to date;
alter table public.bite_folio_entries add column unit_rate numeric(14,2);
alter table public.bite_folio_entries add column policy_tag text;
alter table public.bite_folio_entries add constraint bite_room_allocation_valid check((service_from is null and service_to is null and unit_rate is null) or (service_from is not null and service_to is not null and unit_rate is not null and category='room' and service_to>service_from and unit_rate between 0 and 999999999999.99));
create unique index bite_folio_policy_once on public.bite_folio_entries(folio_id,policy_tag) where policy_tag is not null;
alter table public.bite_property_shift_closings add column locked boolean not null default false;
alter table public.bite_property_shift_closings add column locked_at timestamptz;
alter table public.bite_property_shift_closings add column locked_by uuid references auth.users(id);
alter table public.bite_property_shift_closings add column lock_review jsonb;

create table public.bite_service_tasks (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.bite_properties(id),
 kind text not null check(kind in ('cleaning','room_service')),room_id uuid not null,stay_id uuid,order_id uuid unique references public.orders(id),
 status text not null default 'requested' check(status in ('requested','assigned','in_progress','ready','completed','cancelled')),
 assigned_to uuid references auth.users(id),note text not null default '' check(length(note)<=250),
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(property_id,room_id) references public.bite_rooms(property_id,id),foreign key(property_id,stay_id) references public.bite_stays(property_id,id)
);
create index bite_service_tasks_scope on public.bite_service_tasks(property_id,status,created_at);
create unique index bite_cleaning_task_active on public.bite_service_tasks(property_id,room_id,coalesce(stay_id,'00000000-0000-0000-0000-000000000000'::uuid)) where kind='cleaning' and status not in ('completed','cancelled');
create table public.bite_folio_refund_requests (
 id uuid primary key default gen_random_uuid(),property_id uuid not null,folio_id uuid not null,
 amount numeric(14,2) not null check(amount between 0.01 and 999999999999.99),method text not null check(method in ('Cash','UPI','Card','Bank Transfer','Other')),
 status text not null default 'requested' check(status in ('requested','processing','paid','failed','cancelled')),
 reason text not null check(length(trim(reason)) between 1 and 250),reference text not null default '' check(length(reference)<=100),
 entry_id uuid unique references public.bite_folio_entries(id),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(property_id,folio_id) references public.bite_folios(property_id,id)
);
create index bite_refund_requests_scope on public.bite_folio_refund_requests(property_id,folio_id,status);
create table public.bite_guest_folio_links (
 folio_id uuid primary key,property_id uuid not null,token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,revoked_at timestamptz,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(property_id,folio_id) references public.bite_folios(property_id,id)
);
create table public.bite_stay_compliance (
 stay_id uuid primary key,property_id uuid not null,travel_document_checked boolean not null default false,permission_checked boolean not null default false,
 record_retained_externally boolean not null default false,arrived_from text not null default '',previous_stay text not null default '',purpose text not null default '',next_destination text not null default '',
 arrival_reference text not null default '',arrival_reported_at timestamptz,departure_reference text not null default '',departure_reported_at timestamptz,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),foreign key(property_id,stay_id) references public.bite_stays(property_id,id)
);
create table public.bite_outlet_applications (
 restaurant_id uuid primary key references public.restaurants(id) deferrable initially deferred,property_id uuid not null references public.bite_properties(id),
 submitted_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.bite_service_tasks enable row level security;
alter table public.bite_folio_refund_requests enable row level security;
alter table public.bite_guest_folio_links enable row level security;
alter table public.bite_stay_compliance enable row level security;
alter table public.bite_outlet_applications enable row level security;
revoke all on public.bite_service_tasks,public.bite_folio_refund_requests,public.bite_guest_folio_links,public.bite_stay_compliance,public.bite_outlet_applications from public,anon,authenticated;
grant select on public.bite_service_tasks,public.bite_folio_refund_requests,public.bite_stay_compliance,public.bite_outlet_applications to authenticated;
create policy property_service_read on public.bite_service_tasks for select to authenticated using((kind='cleaning' and private.bite_can(property_id,'housekeeping')) or (kind='room_service' and private.bite_can(property_id,'room_service')));
create policy property_refund_read on public.bite_folio_refund_requests for select to authenticated using(private.bite_can(property_id,'folios'));
create policy property_compliance_read on public.bite_stay_compliance for select to authenticated using(private.bite_can(property_id,'guest_register'));
create policy property_application_read on public.bite_outlet_applications for select to authenticated using(private.bite_can(property_id,'manage_modules'));

create function private.bite_policy_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p)='object' and coalesce((p->>'early_checkin_fee')::numeric,0) between 0 and 1000000 and coalesce((p->>'early_checkin_fee')::numeric,0)=round(coalesce((p->>'early_checkin_fee')::numeric,0),2)
 and coalesce((p->>'late_fee_per_hour')::numeric,0) between 0 and 1000000 and coalesce((p->>'late_fee_per_hour')::numeric,0)=round(coalesce((p->>'late_fee_per_hour')::numeric,0),2)
 and coalesce((p->>'grace_minutes')::integer,30) between 0 and 240 and coalesce((p->>'turnover_minutes')::integer,30) between 0 and 240
 and coalesce((p->>'max_late_hours')::integer,12) between 1 and 24 and coalesce((p->>'unused_night_credit_percent')::numeric,0) between 0 and 100 and coalesce((p->>'fee_tax_rate')::numeric,0) between 0 and 100
$$;
create function private.bite_policy_quote(p_stay uuid,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.bite_stays;pr public.bite_properties;f public.bite_folios;cfg jsonb;credit numeric:=0;credit_tax numeric:=0;late numeric:=0;hours numeric:=0;first_unused date;mins numeric;v jsonb;room_net numeric;tax_net numeric;
begin
 select * into strict s from public.bite_stays where id=p_stay;select * into strict pr from public.bite_properties where id=s.property_id;
 select * into strict f from public.bite_folios where stay_id=s.id;cfg:=s.policy_snapshot;
 if f.checkout_policy is not null then return f.checkout_policy;end if;
 if coalesce((cfg->>'reviewed')::boolean,false) then
  first_unused:=(p_at at time zone pr.timezone)::date;
  if (p_at at time zone pr.timezone)::time>coalesce((cfg->>'checkout_time')::time,pr.checkout_time) then first_unused:=first_unused+1;end if;
  if first_unused<s.departure then
   if exists(select 1 from public.bite_folio_entries e where e.folio_id=f.id and e.category='room' and e.kind='charge' and e.status='confirmed' and e.policy_tag is null and e.service_from is null and not exists(select 1 from public.bite_folio_entries rv where rv.reversal_of=e.id)) and coalesce((cfg->>'unused_night_credit_percent')::numeric,0)>0 then raise exception 'Room-night allocation needs manual review before an early checkout credit';end if;
   select coalesce(sum(round(greatest(0,e.service_to-greatest(e.service_from,first_unused))*e.unit_rate*coalesce((cfg->>'unused_night_credit_percent')::numeric,0)/100,2)),0) into credit
   from public.bite_folio_entries e where e.folio_id=f.id and e.category='room' and e.kind='charge' and e.status='confirmed' and e.service_to>first_unused and not exists(select 1 from public.bite_folio_entries rv where rv.reversal_of=e.id);
   select greatest(0,coalesce(sum(case when kind='charge' then amount when kind in ('discount','reversal') then -amount else 0 end),0)),greatest(0,coalesce(sum(case when kind='charge' then tax_amount when kind in ('discount','reversal') then -tax_amount else 0 end),0)) into room_net,tax_net from public.bite_folio_entries where folio_id=f.id and category='room' and status='confirmed';
   credit:=least(credit,room_net);credit_tax:=least(round(credit*s.room_tax_rate/100,2),tax_net);
  end if;
  mins:=greatest(0,extract(epoch from (p_at-coalesce(s.standard_checkout_at,(s.departure+pr.checkout_time) at time zone pr.timezone)))/60-coalesce((cfg->>'grace_minutes')::integer,30));
  hours:=ceil(mins/60);
  if hours>coalesce((cfg->>'max_late_hours')::integer,12) and coalesce((cfg->>'late_fee_per_hour')::numeric,0)>0 and not s.late_fee_waived then raise exception 'Extend the stay and review the rate before overdue checkout';end if;
  if not s.late_fee_waived then late:=hours*coalesce((cfg->>'late_fee_per_hour')::numeric,0);end if;
 end if;
 v:=jsonb_build_object('early_credit',credit,'early_credit_tax',credit_tax,'late_fee',late,'late_tax',round(late*coalesce((cfg->>'fee_tax_rate')::numeric,0)/100,2),'started_late_hours',hours,'policy_reviewed',coalesce((cfg->>'reviewed')::boolean,false));
 return v||jsonb_build_object('quote_hash',md5(v::text),'quoted_at',p_at);
end $$;
create function private.bite_checkout_policy_quote(p_property uuid,p_stay uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.bite_can(p_property,'folios') or not exists(select 1 from public.bite_stays where property_id=p_property and id=p_stay) then raise exception 'Stay access denied' using errcode='42501';end if;
 return private.bite_policy_quote(p_stay,now());end $$;
create function public.bite_checkout_policy_quote(p_property uuid,p_stay uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bite_checkout_policy_quote(p_property,p_stay)$$;

create function private.bite_check_room_timing(p_property uuid,p_room uuid,p_arrival date,p_departure date,p_ignore uuid default null) returns void
language plpgsql stable security definer set search_path='' as $$declare pr public.bite_properties;begin
 select * into strict pr from public.bite_properties where id=p_property;
 if exists(select 1 from public.bite_stays s where s.property_id=p_property and s.room_id=p_room and s.id is distinct from p_ignore and s.status in ('reserved','in_house')
 and s.departure=p_arrival and coalesce(s.expected_checkout_at,(s.departure+pr.checkout_time) at time zone pr.timezone)+make_interval(mins=>coalesce((s.policy_snapshot->>'turnover_minutes')::integer,0))>(p_arrival+pr.checkin_time) at time zone pr.timezone) then raise exception 'Approved late checkout and cleaning time conflict with this arrival';end if;
end $$;
create function private.bite_reservation_quote(p_property uuid,p_details jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pr public.bite_properties;r public.bite_rooms;prior public.bite_stays;a date;d date;rate numeric;nightly numeric;total numeric;early numeric:=0;fee_tax numeric;cfg jsonb;v jsonb;ignored uuid;begin
 if not private.bite_can(p_property,'reservations') then raise exception 'Reservation access denied' using errcode='42501';end if;
 select * into strict pr from public.bite_properties where id=p_property;
 select * into strict r from public.bite_rooms where id=(p_details->>'room_id')::uuid and property_id=p_property and active;
 ignored:=nullif(p_details->>'stay_id','')::uuid;
 if ignored is not null then select * into strict prior from public.bite_stays where id=ignored and property_id=p_property and status='reserved';end if;
 cfg:=case when ignored is null then pr.hotel_policy else prior.policy_snapshot end;
 a:=(p_details->>'arrival')::date;d:=(p_details->>'departure')::date;
 if a is null or d is null or d<=a or d-a>365 or coalesce((p_details->>'adults')::integer,0) not between 1 and r.adults or coalesce((p_details->>'children')::integer,0) not between 0 and r.children then raise exception 'Check stay dates and room occupancy';end if;
 if r.housekeeping='blocked' or exists(select 1 from public.bite_stays where room_id=r.id and id is distinct from ignored and status in ('reserved','in_house') and daterange(arrival,departure,'[)')&&daterange(a,d,'[)')) then raise exception 'Room unavailable for these dates';end if;
 perform private.bite_check_room_timing(p_property,r.id,a,d,ignored);
 if p_details->>'mode'='checkin' then
  if r.housekeeping<>'ready' or exists(select 1 from public.bite_stays where room_id=r.id and id is distinct from ignored and status='in_house') then raise exception 'Room is not inspected Ready for arrival';end if;
  if coalesce((cfg->>'reviewed')::boolean,false) and now()<(a+coalesce((cfg->>'checkin_time')::time,pr.checkin_time)) at time zone pr.timezone then early:=coalesce((cfg->>'early_checkin_fee')::numeric,0);end if;
 end if;
 rate:=case when ignored is not null then prior.room_tax_rate when coalesce((pr.tax_profile->>'reviewed')::boolean,false) then coalesce((pr.tax_profile->>'room_rate')::numeric,0) else 0 end;
 nightly:=case when ignored is not null then prior.nightly_rate else r.nightly_rate end;
 fee_tax:=case when ignored is not null or coalesce((pr.tax_profile->>'reviewed')::boolean,false) then coalesce((cfg->>'fee_tax_rate')::numeric,0) else 0 end;
 total:=nightly*(d-a);
 v:=jsonb_build_object('room',total,'room_tax',round(total*rate/100,2),'early_fee',early,'early_tax',round(early*fee_tax/100,2),'total',total+round(total*rate/100,2)+early+round(early*fee_tax/100,2),'nightly_rate',nightly,'policy',cfg);
 return v||jsonb_build_object('quote_hash',md5(v::text));
end $$;
create function public.bite_reservation_quote(p_property uuid,p_details jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.bite_reservation_quote(p_property,p_details)$$;

create function private.bite_ensure_cleaning(p_property uuid,p_room uuid,p_stay uuid,p_note text default '') returns uuid
language plpgsql set search_path='' as $$declare t uuid;begin
 select id into t from public.bite_service_tasks where property_id=p_property and room_id=p_room and stay_id is not distinct from p_stay and kind='cleaning' and status not in ('completed','cancelled');
 if t is null then insert into public.bite_service_tasks(property_id,room_id,stay_id,kind,note,created_by)values(p_property,p_room,p_stay,'cleaning',left(p_note,250),auth.uid())returning id into t;end if;return t;
end $$;

-- Legacy restaurant sources already serialize on these exact day keys. The
-- closing takes the same locks; source guards never acquire a property-row lock.
create function private.bite_guard_combined_restaurant_day() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb;b jsonb;old_r uuid;new_r uuid;old_d date;new_d date;k1 bigint;k2 bigint;begin
 -- Never block activation/correction of a paid marketplace order because of a
 -- local drawer closing. Gateway operations keep their original safeguards.
 if TG_TABLE_NAME='orders' then
  if TG_OP='DELETE' then if coalesce(old.channel,'') not like 'POS - %' then return old;end if;
  elsif coalesce(new.channel,'') not like 'POS - %' then return new;end if;
 end if;
 if TG_OP<>'INSERT' then a:=to_jsonb(old);old_r:=(a->>'restaurant_id')::uuid;old_d:=case when TG_ARGV[0]='order_date' then ((a->>'order_date')::timestamptz at time zone 'Asia/Kolkata')::date else (a->>TG_ARGV[0])::date end;end if;
 if TG_OP<>'DELETE' then b:=to_jsonb(new);new_r:=(b->>'restaurant_id')::uuid;new_d:=case when TG_ARGV[0]='order_date' then ((b->>'order_date')::timestamptz at time zone 'Asia/Kolkata')::date else (b->>TG_ARGV[0])::date end;end if;
 k1:=case when old_r is not null then hashtextextended('bite.cashbook.day.v1|'||old_r::text||'|'||old_d::text,0)end;
 k2:=case when new_r is not null then hashtextextended('bite.cashbook.day.v1|'||new_r::text||'|'||new_d::text,0)end;
 if k1 is not null and k2 is not null then perform pg_advisory_xact_lock(least(k1,k2));if k1<>k2 then perform pg_advisory_xact_lock(greatest(k1,k2));end if;
 elsif k1 is not null then perform pg_advisory_xact_lock(k1);elsif k2 is not null then perform pg_advisory_xact_lock(k2);end if;
 if exists(select 1 from public.bite_property_outlets o join public.bite_property_shift_closings c on c.property_id=o.property_id where c.locked and ((o.restaurant_id=old_r and c.shift_date=old_d) or (o.restaurant_id=new_r and c.shift_date=new_d))) then raise exception 'Combined property day is locked. Use a reviewed later-day correction';end if;
 if TG_OP='DELETE' then return old;end if;return new;end $$;
create function private.bite_guard_combined_hotel_day() returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid;d1 date;d2 date;begin
 p:=case when TG_OP='DELETE' then old.property_id else new.property_id end;
 perform 1 from public.bite_properties where id=p for update;
 if TG_OP<>'INSERT' then d1:=case when TG_TABLE_NAME='bite_property_expenses' then (to_jsonb(old)->>'expense_date')::date else ((to_jsonb(old)->>'created_at')::timestamptz at time zone 'Asia/Kolkata')::date end;end if;
 if TG_OP<>'DELETE' then d2:=case when TG_TABLE_NAME='bite_property_expenses' then (to_jsonb(new)->>'expense_date')::date else ((to_jsonb(new)->>'created_at')::timestamptz at time zone 'Asia/Kolkata')::date end;end if;
 if exists(select 1 from public.bite_property_shift_closings where property_id=p and locked and shift_date in (d1,d2)) then raise exception 'Combined property day is locked. Use a reviewed later-day correction';end if;
 if TG_OP='DELETE' then return old;end if;return new;end $$;
create trigger bite_hotel_closed_day before insert or update or delete on public.bite_folio_entries for each row execute function private.bite_guard_combined_hotel_day();
create trigger bite_hotel_closed_day before insert or update or delete on public.bite_property_expenses for each row execute function private.bite_guard_combined_hotel_day();
do $$declare t text;d text;begin
 for t,d in select * from (values('orders','order_date'),('restaurant_expenses','expense_date'),('restaurant_purchases','purchase_date'),('restaurant_cashbook_manual_entries','entry_date'),('restaurant_order_payments','payment_date'),('restaurant_employee_payments','payment_date'),('restaurant_customer_ledger_entries','entry_date'),('restaurant_order_refunds','refund_date')) v(t,d) loop
  if to_regclass('public.'||t) is not null then execute format('create trigger zz_bite_combined_day_guard before insert or update or delete on public.%I for each row execute function private.bite_guard_combined_restaurant_day(%L)',t,d);end if;
 end loop;end $$;

-- Read-only guest bearer links: 244+ bits of randomness, only hashes at rest,
-- one folio, 72h expiry, revocation, and no ID/address/phone/bank-account data.
create function private.bite_guest_link(p_property uuid,p_folio uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare token text;begin
 if not private.bite_can(p_property,'folios') or private.bite_property_role(p_property) not in ('owner','manager','receptionist') or not exists(select 1 from public.bite_folios where property_id=p_property and id=p_folio) then raise exception 'Folio sharing denied' using errcode='42501';end if;
 perform 1 from public.bite_properties where id=p_property for update;
 token:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 insert into public.bite_guest_folio_links(property_id,folio_id,token_hash,expires_at,created_by)values(p_property,p_folio,encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '72 hours',auth.uid())
 on conflict(folio_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,revoked_at=null,created_by=excluded.created_by,created_at=now();
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)values(p_property,auth.uid(),'share_guest_folio',p_folio,gen_random_uuid());
 return jsonb_build_object('token',token,'expires_at',now()+interval '72 hours');end $$;
create function public.bite_guest_link(p_property uuid,p_folio uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bite_guest_link(p_property,p_folio)$$;
create function private.bite_guest_folio(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare l public.bite_guest_folio_links;f public.bite_folios;s public.bite_stays;begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'This guest link is invalid or expired' using errcode='42501';end if;
 select * into l from public.bite_guest_folio_links where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and expires_at>now() and revoked_at is null;
 if not found then raise exception 'This guest link is invalid or expired' using errcode='42501';end if;
 select * into strict f from public.bite_folios where id=l.folio_id and property_id=l.property_id;select * into strict s from public.bite_stays where id=f.stay_id;
 return jsonb_build_object('property',(select jsonb_build_object('name',name,'phone',phone) from public.bite_properties where id=l.property_id),'number',coalesce(f.invoice_number,'Open guest folio'),'status',f.status,'stay_status',s.status,'arrival',s.arrival,'departure',s.departure,'totals',private.bite_folio_totals(f.id),'expires_at',l.expires_at,
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'description',description,'amount',amount,'tax',tax_amount,'status',status,'method',method,'reference_tail',case when length(reference)>0 then right(reference,4)else ''end)order by created_at),'[]'::jsonb) from public.bite_folio_entries where folio_id=f.id),
 'refunds',(select coalesce(jsonb_agg(jsonb_build_object('amount',amount,'status',status,'method',method,'reference_tail',case when length(reference)>0 then right(reference,4)else ''end,'updated_at',updated_at)order by created_at),'[]'::jsonb) from public.bite_folio_refund_requests where folio_id=f.id));end $$;
-- An intentionally public, token-scoped reader. No private-schema grants to anon.
create function public.bite_guest_folio(p_token text) returns jsonb language sql stable security definer set search_path='' as $$select private.bite_guest_folio(p_token)$$;
revoke all on function public.bite_guest_folio(text) from public;
grant execute on function public.bite_guest_folio(text) to anon,authenticated;

revoke all on function private.bite_policy_valid(jsonb),private.bite_policy_quote(uuid,timestamptz),private.bite_checkout_policy_quote(uuid,uuid),private.bite_check_room_timing(uuid,uuid,date,date,uuid),private.bite_reservation_quote(uuid,jsonb),private.bite_ensure_cleaning(uuid,uuid,uuid,text),private.bite_guard_combined_restaurant_day(),private.bite_guard_combined_hotel_day(),private.bite_guest_link(uuid,uuid),private.bite_guest_folio(text),public.bite_checkout_policy_quote(uuid,uuid),public.bite_reservation_quote(uuid,jsonb),public.bite_guest_link(uuid,uuid) from public,anon,authenticated;
grant execute on function private.bite_checkout_policy_quote(uuid,uuid),private.bite_reservation_quote(uuid,jsonb),private.bite_guest_link(uuid,uuid),public.bite_checkout_policy_quote(uuid,uuid),public.bite_reservation_quote(uuid,jsonb),public.bite_guest_link(uuid,uuid) to authenticated;

-- Approved association reuses the existing restaurant/Admin onboarding row.
create function private.bite_verified_owner_portfolio(p_owner uuid,p_target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (auth.uid()=p_owner or public.is_platform_admin() or coalesce(auth.jwt()->>'role','')='service_role' or session_user in ('postgres','supabase_admin'))
 and exists(select 1 from public.bite_properties pr join public.bite_businesses b on b.id=pr.business_id join public.bite_property_members m on m.property_id=pr.id and m.user_id=p_owner and m.active and m.role='owner'
  where b.owner_id=p_owner and (exists(select 1 from public.bite_outlet_applications a where a.restaurant_id=p_target and a.property_id=pr.id and a.submitted_by=p_owner) or exists(select 1 from public.bite_property_outlets o where o.property_id=pr.id and o.restaurant_id=p_target)))
 and not exists(select 1 from public.restaurant_members own join public.restaurant_members other on other.restaurant_id=own.restaurant_id and other.role='owner' and other.user_id<>p_owner where own.user_id=p_owner and own.role='owner')
 and not exists(select 1 from public.restaurant_members old where old.user_id=p_owner and old.role='owner' and old.restaurant_id<>p_target and not exists(
  select 1 from public.bite_properties pr join public.bite_businesses b on b.id=pr.business_id where b.owner_id=p_owner and (exists(select 1 from public.bite_property_outlets o where o.property_id=pr.id and o.restaurant_id=old.restaurant_id) or exists(select 1 from public.bite_outlet_applications a where a.property_id=pr.id and a.restaurant_id=old.restaurant_id and a.submitted_by=p_owner))))
$$;
-- Constraint continues to forbid two owners of one restaurant and Admin/Owner
-- role crossover. Only a verified portfolio can have multiple owned outlets.
create or replace function public.enforce_single_restaurant_owner_assignment() returns trigger language plpgsql set search_path='' as $$begin
 if new.role<>'owner' then return new;end if;
 if TG_OP='UPDATE' and new.restaurant_id=old.restaurant_id and new.user_id=old.user_id and new.role=old.role then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.restaurant_id::text,0));perform pg_advisory_xact_lock(hashtextextended('owner-user:'||new.user_id::text,0));
 if exists(select 1 from public.platform_admins where user_id=new.user_id) then raise exception 'A Platform Admin account cannot also be assigned as a Restaurant Owner.';end if;
 if exists(select 1 from public.restaurant_members where restaurant_id=new.restaurant_id and role='owner' and user_id<>new.user_id) then raise exception 'This restaurant already has an Owner account. Resolve the existing Owner mapping before assigning another.';end if;
 if exists(select 1 from public.restaurant_members where user_id=new.user_id and role='owner' and restaurant_id<>new.restaurant_id) and not private.bite_verified_owner_portfolio(new.user_id,new.restaurant_id) then raise exception 'This Owner account is already assigned to another restaurant. Resolve the existing Owner mapping first.';end if;
 return new;end $$;
create function private.bite_attach_approved_outlet() returns trigger language plpgsql security definer set search_path='' as $$declare a record;begin
 if new.status='Active' and new.onboarding_status='approved' then
  for a in select app.property_id,b.owner_id from public.bite_outlet_applications app join public.bite_properties pr on pr.id=app.property_id join public.bite_businesses b on b.id=pr.business_id where app.restaurant_id=new.id and 'restaurant_menu'=any(pr.capabilities) loop
   if (select count(*) from public.restaurant_members where restaurant_id=new.id and role='owner')=1 and exists(select 1 from public.restaurant_members where restaurant_id=new.id and user_id=a.owner_id and role='owner') and exists(select 1 from public.bite_property_members where property_id=a.property_id and user_id=a.owner_id and role='owner' and active) and not exists(select 1 from public.bite_property_outlets where restaurant_id=new.id and property_id<>a.property_id) then
    insert into public.bite_property_outlets(property_id,restaurant_id) values(a.property_id,new.id) on conflict do nothing;
   end if;
  end loop;
 end if;return new;end $$;
create trigger bite_approved_property_outlet after update of status,onboarding_status on public.restaurants for each row execute function private.bite_attach_approved_outlet();

-- Extend the guarded read model; preserve the existing restaurant/guest scoping.
alter function private.bite_hotel_workspace(uuid) rename to bite_hotel_workspace_before_remaining;
create function private.bite_hotel_workspace(p_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;begin
 v:=private.bite_hotel_workspace_before_remaining(p_property);
 v:=v||jsonb_build_object('tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('name',item_name,'quantity',quantity)),'[]'::jsonb) from public.order_items where order_id=t.order_id))order by t.created_at),'[]'::jsonb) from public.bite_service_tasks t where t.property_id=p_property and ((t.kind='cleaning' and private.bite_can(p_property,'housekeeping')) or (t.kind='room_service' and private.bite_can(p_property,'room_service')))));
 if private.bite_can(p_property,'housekeeping') or private.bite_can(p_property,'room_service') then v:=v||jsonb_build_object('task_members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),m.role||' account'))),'[]'::jsonb) from public.bite_property_members m join auth.users u on u.id=m.user_id where m.property_id=p_property and m.active and m.role in ('owner','manager','housekeeping','cashier')));end if;
 if private.bite_can(p_property,'folios') then v:=v||jsonb_build_object('refund_requests',(select coalesce(jsonb_agg(r order by r.created_at),'[]'::jsonb) from public.bite_folio_refund_requests r where r.property_id=p_property));end if;
 if private.bite_can(p_property,'guest_register') then v:=v||jsonb_build_object('compliance',(select coalesce(jsonb_agg(c),'[]'::jsonb) from public.bite_stay_compliance c where c.property_id=p_property));end if;
 if private.bite_can(p_property,'manage_modules') then
  v:=v||jsonb_build_object('outlet_applications',(select coalesce(jsonb_agg(jsonb_build_object('restaurant_id',r.id,'name',r.name,'status',r.status,'onboarding_status',r.onboarding_status,'reason',r.onboarding_rejection_reason)),'[]'::jsonb) from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property),
   'available_outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'city',r.city,'eligible',r.status='Active' and r.onboarding_status='approved')),'[]'::jsonb) from public.restaurant_members m join public.restaurants r on r.id=m.restaurant_id where m.user_id=auth.uid() and m.role='owner' and not exists(select 1 from public.bite_property_outlets o where o.restaurant_id=r.id)));
 end if;return v;end $$;
create or replace function public.bite_hotel_workspace(p_property uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bite_hotel_workspace(p_property)$$;
alter function private.bite_owner_context() rename to bite_owner_context_before_remaining;
create function private.bite_owner_context() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x||jsonb_build_object('hotel_policy',p.hotel_policy)),'[]'::jsonb) from jsonb_array_elements(private.bite_owner_context_before_remaining()) x join public.bite_properties p on p.id=(x->>'id')::uuid
$$;
create or replace function public.bite_owner_context() returns jsonb language sql security invoker set search_path='' as $$select private.bite_owner_context()$$;

-- Reuse existing operation audit logging for scoped restaurant changes.
do $$declare t text;begin
 foreach t in array array['restaurants','restaurant_members','orders','order_items','restaurant_order_payments','restaurant_order_refunds','menu_items','menu_categories','restaurant_tables','restaurant_expenses','restaurant_purchases','restaurant_suppliers','restaurant_cashbook_manual_entries','restaurant_cashbook_closings','restaurant_employees','restaurant_employee_payments','restaurant_attendance','restaurant_leave_requests','restaurant_employee_adjustments','restaurant_inventory_items','restaurant_inventory_movements','restaurant_customer_ledger_entries'] loop
  if to_regclass('public.'||t) is not null and not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||t) and tgfoid='public.bite_audit_control_change()'::regprocedure and not tgisinternal) then execute format('create trigger bite_property_operation_audit after insert or update or delete on public.%I for each row execute function public.bite_audit_control_change()',t);end if;
 end loop;end $$;
create index bite_operation_audit_timeline on public.bite_operation_audit(created_at desc,id);
create index bite_operation_audit_outlet on public.bite_operation_audit((coalesce(detail->'after'->>'restaurant_id',detail->'before'->>'restaurant_id')),created_at desc);
create function private.bite_audit_outlet(p_row jsonb,p_table text) returns uuid language plpgsql stable security definer set search_path='' as $$declare v text;begin
 v:=case when p_table='restaurants' then p_row->>'id' else p_row->>'restaurant_id' end;
 if v ~ '^[0-9a-f-]{36}$' then return v::uuid;end if;
 if p_table='order_items' and p_row->>'order_id' ~ '^[0-9a-f-]{36}$' then return (select restaurant_id from public.orders where id=(p_row->>'order_id')::uuid);end if;
 return null;end $$;
create function private.bite_unified_audit(p_property uuid,p_query text,p_cursor text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare before_at timestamptz;before_key text;c jsonb;rows jsonb;last_row jsonb;begin
 if not private.bite_can(p_property,'reporting') then raise exception 'Audit access denied' using errcode='42501';end if;
 if p_cursor is not null then if length(p_cursor)>500 then raise exception 'Invalid cursor';end if;c:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;before_at:=(c->>'at')::timestamptz;before_key:=c->>'key';end if;
 with events as (
  select 'property:'||a.id::text key,'Property'::text source,a.action,a.entity_id,a.actor_id,a.created_at,''::text label from public.bite_property_audit a where a.property_id=p_property
  union all
  select 'operation:'||a.id::text,'Restaurant',a.action,a.entity_id,a.actor_id,a.created_at,left(coalesce(a.detail->'after'->>'order_code',a.detail->'before'->>'order_code',a.detail->'after'->>'name',a.detail->'before'->>'name',a.detail->'after'->>'item_name',a.detail->'before'->>'item_name',''),120)
  from public.bite_operation_audit a where exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=private.bite_audit_outlet(coalesce(nullif(a.detail->'after','null'::jsonb),a.detail->'before'),a.detail->>'table'))
  union all
  select 'platform:'||a.id::text,'Platform',a.action,a.entity_id,a.actor_id,a.created_at,'' from public.platform_audit_logs a where exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=case when a.details->>'restaurant_id' ~ '^[0-9a-f-]{36}$' then (a.details->>'restaurant_id')::uuid when a.entity_type='restaurant' then a.entity_id else null end)
 ), page as (select e.*,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),'Staff / system') actor_name from events e left join auth.users u on u.id=e.actor_id where (p_query='' or p_query is null or concat_ws(' ',e.action,e.label,e.entity_id::text) ilike '%'||left(p_query,100)||'%') and (before_at is null or (e.created_at,e.key)<(before_at,before_key)) order by e.created_at desc,e.key desc limit 100)
 select coalesce(jsonb_agg(to_jsonb(page)order by created_at desc,key desc),'[]'::jsonb) into rows from page;
 if jsonb_array_length(rows)=100 then last_row:=rows->99;c:=jsonb_build_object('at',last_row->>'created_at','key',last_row->>'key');return jsonb_build_object('rows',rows,'next_cursor',encode(convert_to(c::text,'UTF8'),'base64'));end if;
 return jsonb_build_object('rows',rows,'next_cursor',null);end $$;
create function public.bite_unified_audit(p_property uuid,p_query text,p_cursor text default null) returns jsonb language sql security invoker set search_path='' as $$select private.bite_unified_audit(p_property,p_query,p_cursor)$$;
create function private.bite_platform_owner_contexts() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.is_platform_admin() then raise exception 'Platform Admin required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'restaurant_id',m.restaurant_id,'verified',private.bite_verified_owner_portfolio(m.user_id,m.restaurant_id))),'[]'::jsonb) from public.restaurant_members m where m.role='owner');end $$;
create function public.bite_platform_owner_contexts() returns jsonb language sql security invoker set search_path='' as $$select private.bite_platform_owner_contexts()$$;

-- Include every revenue input in review freshness; preserve original money math.
alter function private.bite_property_report(uuid,date,date) rename to bite_property_report_before_remaining;
create function private.bite_property_report(p_property uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$declare v jsonb;h text;r text;begin
 v:=private.bite_property_report_before_remaining(p_property,p_from,p_to);
 select md5(coalesce(string_agg(id::text||kind||amount::text||tax_amount::text||status,'|' order by id),'')) into h from public.bite_folio_entries where property_id=p_property and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
 select md5(coalesce(string_agg(o.id::text||o.amount::text||o.waived_off_amount::text||o.status,'|' order by o.id),'')) into r from public.orders o join public.bite_property_outlets po on po.restaurant_id=o.restaurant_id where po.property_id=p_property and (o.order_date at time zone 'Asia/Kolkata')::date between p_from and p_to;
 return v||jsonb_build_object('source_hash',md5((v->>'source_hash')||h||r));end $$;
create or replace function public.bite_property_report(p_property uuid,p_from date,p_to date) returns jsonb language sql security invoker set search_path='' as $$select private.bite_property_report(p_property,p_from,p_to)$$;

revoke all on function private.bite_verified_owner_portfolio(uuid,uuid),private.bite_attach_approved_outlet(),private.bite_hotel_workspace_before_remaining(uuid),private.bite_hotel_workspace(uuid),private.bite_owner_context_before_remaining(),private.bite_owner_context(),private.bite_audit_outlet(jsonb,text),private.bite_unified_audit(uuid,text,text),private.bite_platform_owner_contexts(),private.bite_property_report_before_remaining(uuid,date,date),private.bite_property_report(uuid,date,date),public.bite_unified_audit(uuid,text,text),public.bite_platform_owner_contexts() from public,anon,authenticated;
grant execute on function private.bite_verified_owner_portfolio(uuid,uuid),private.bite_hotel_workspace(uuid),private.bite_owner_context(),private.bite_unified_audit(uuid,text,text),private.bite_platform_owner_contexts(),private.bite_property_report(uuid,date,date),public.bite_unified_audit(uuid,text,text),public.bite_platform_owner_contexts() to authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_owner_mapping(p_user_id uuid,p_restaurant_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform Admin access required.'; END IF;
  IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN RAISE EXCEPTION 'Choose an Owner account and restaurant.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id) THEN RAISE EXCEPTION 'Owner account was not found.'; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user_id) THEN RAISE EXCEPTION 'A Platform Admin cannot be assigned as a Restaurant Owner.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=p_restaurant_id) THEN RAISE EXCEPTION 'Restaurant was not found.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bite-owner-user:'||p_user_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('bite-owner-restaurant:'||p_restaurant_id::text,0));
  SELECT coalesce(jsonb_agg(jsonb_build_object('restaurant_id',restaurant_id,'user_id',user_id,'role',role)),'[]'::jsonb)
    INTO v_before FROM public.restaurant_members
    WHERE role='owner' AND (user_id=p_user_id OR restaurant_id=p_restaurant_id);
  IF (select count(*) from public.restaurant_members where user_id=p_user_id and role='owner')>1 AND private.bite_verified_owner_portfolio(p_user_id,p_restaurant_id) THEN RAISE EXCEPTION 'Verified portfolios must not be resolved as conflicts. Review an explicit business ownership transfer instead.'; END IF;
  DELETE FROM public.restaurant_members WHERE user_id=p_user_id AND restaurant_id<>p_restaurant_id;
  DELETE FROM public.restaurant_members WHERE restaurant_id=p_restaurant_id AND role='owner' AND user_id<>p_user_id;
  UPDATE public.restaurant_members SET role='owner' WHERE restaurant_id=p_restaurant_id AND user_id=p_user_id AND role<>'owner';
  INSERT INTO public.restaurant_members(restaurant_id,user_id,role)
    SELECT p_restaurant_id,p_user_id,'owner'
    WHERE NOT EXISTS(SELECT 1 FROM public.restaurant_members WHERE restaurant_id=p_restaurant_id AND user_id=p_user_id AND role='owner');
  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),'owner_mapping_resolved','restaurant',p_restaurant_id,
      jsonb_build_object('selected_owner_user_id',p_user_id,'previous_owner_memberships',v_before));
  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_replace_owner_mapping(p_restaurant_id uuid, p_expected_owner_id uuid, p_new_owner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_existing uuid[];
begin
 if (select auth.uid()) is null or not public.is_platform_admin() then
  raise exception 'Only the Platform Super Admin can replace a restaurant Owner.';
 end if;
 if p_restaurant_id is null or p_expected_owner_id is null or p_new_owner_id is null
    or p_expected_owner_id = p_new_owner_id then
  raise exception 'Valid previous and new Owner IDs are required.';
 end if;
 if not exists(select 1 from public.restaurants r where r.id=p_restaurant_id) then
  raise exception 'Restaurant not found. Refresh the mapping.';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_new_owner_id) then
  raise exception 'New Owner account does not exist.';
 end if;
 if exists(select 1 from public.platform_admins pa where pa.user_id=p_new_owner_id) then
  raise exception 'Platform Admin account cannot become a Restaurant Owner.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('bite-owner-restaurant:'||p_restaurant_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bite-owner-user:'||p_new_owner_id::text,0));
 select array_agg(m.user_id) into v_existing from public.restaurant_members m
 where m.restaurant_id=p_restaurant_id and m.role='owner';
 if coalesce(array_length(v_existing,1),0)<>1 or v_existing[1]<>p_expected_owner_id then
  raise exception 'Restaurant Owner changed. Refresh before replacing.';
 end if;
 if exists(select 1 from public.restaurant_members m where m.user_id=p_new_owner_id) then
  raise exception 'New Owner login is already assigned to a restaurant.';
 end if;
 if (select count(*) from public.restaurant_members where user_id=p_expected_owner_id and role='owner')>1 and private.bite_verified_owner_portfolio(p_expected_owner_id,p_restaurant_id) then raise exception 'Review a business ownership transfer before replacing a shared portfolio login.';end if;
 delete from public.restaurant_members m
 where m.restaurant_id=p_restaurant_id and m.user_id=p_expected_owner_id and m.role='owner';
 insert into public.restaurant_members(restaurant_id,user_id,role)
 values(p_restaurant_id,p_new_owner_id,'owner');
 insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'owner_login_replaced','restaurant',p_restaurant_id,
  jsonb_build_object('previous_owner_user_id',p_expected_owner_id,'new_owner_user_id',p_new_owner_id));
 return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.admin_replace_owner_mapping(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_owner_mapping(uuid,uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_resolve_owner_mapping(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_owner_mapping(uuid,uuid) TO authenticated;

create or replace function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 task public.bite_service_tasks;job public.bite_folio_refund_requests;cfg jsonb;q jsonb;v_until timestamptz;v_assignee uuid;v_entry uuid;v_key bigint;v_closing uuid;v_lock boolean;
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
  when p_action in ('config','member','policy_save','attach_outlet','outlet_application','outlet_application_edit') then 'manage_modules'
  when p_action in ('room_save','room_status','room_privacy') then 'housekeeping'
  when p_action='guest_save' then 'guest_register'
  when p_action in ('reserve','reserve_group','reservation_edit','checkin','move','extend','cancel','no_show') then 'reservations'
  when p_action in ('room_post','room_pos') then 'charge_to_room'
  when p_action='task_update' then case when exists(select 1 from public.bite_service_tasks where property_id=p_property and id=(p_payload->>'id')::uuid and kind='room_service') then 'room_service' else 'housekeeping' end
  when p_action='compliance_save' then 'guest_register'
  when p_action='pos_sale' then 'restaurant_pos'
  when p_action='close_shift' then 'reporting'
  when p_action='expense' then 'expenses'
  else 'folios' end;
 if not private.bite_can(p_property,cap) then raise exception 'Module or role does not permit this action' using errcode='42501'; end if;
 if role_name='accountant' then raise exception 'Read-only accounting access' using errcode='42501'; end if;
 if p_action in ('room_save','discount','reverse','refund','payment_confirm','payment_void','expense','split_bill','close_shift','late_checkout','apply_checkout_policy','refund_request','refund_update') and role_name not in ('owner','manager') then raise exception 'Owner or manager authorization required' using errcode='42501'; end if;
 -- One property's writes serialize: allocation, ledger writes, config disable and
 -- checkout cannot race. No locks on unrelated restaurant/payment workflows.
 select * into strict prop from public.bite_properties where id=p_property for update;
 select * into prior from public.bite_property_commands where property_id=p_property and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.created_by<>auth.uid() then raise exception 'Request ID already used for different details'; end if;
  return prior.result;
 end if;
 entity:=nullif(p_payload->>'id','')::uuid;
 if p_action in ('move','extend','reservation_edit','late_checkout') and exists(select 1 from public.bite_folios f join public.bite_stays s on s.id=f.stay_id where f.property_id=p_property and s.id=entity and s.status='in_house' and f.checkout_policy is not null) then raise exception 'Checkout terms already finalized; finish settlement before changing this stay';end if;

 if p_action in ('room_pos','pos_sale') then
  if coalesce(jsonb_typeof(p_payload->'items'),'')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 200 then raise exception 'Add 1 to 200 valid POS items';end if;
  for unit in select value from jsonb_array_elements(p_payload->'items') loop
   if length(trim(coalesce(unit->>'name',''))) not between 1 and 120 or (unit->>'quantity')::numeric is null or (unit->>'quantity')::numeric not between 0.01 and 9999 or (unit->>'quantity')::numeric<>round((unit->>'quantity')::numeric,2) or (unit->>'unit_price')::numeric is null or (unit->>'unit_price')::numeric not between 0 and 9999999999.99 or (unit->>'unit_price')::numeric<>round((unit->>'unit_price')::numeric,2) then raise exception 'POS item quantity and price must be finite positive/two-decimal amounts';end if;
  end loop;
 end if;
 if p_action='policy_save' then
  cfg:=p_payload->'policy';
  if cfg is null or not coalesce(private.bite_policy_valid(cfg),false) or nullif(p_payload->>'checkin_time','') is null or nullif(p_payload->>'checkout_time','') is null or p_payload->>'checkin_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_payload->>'checkout_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Review valid policy amounts, times and limits';end if;
  if coalesce((cfg->>'fee_tax_rate')::numeric,0)>0 and not coalesce((prop.tax_profile->>'reviewed')::boolean,false) then raise exception 'Review tax registration/rates before setting fee tax';end if;
  update public.bite_properties set hotel_policy=cfg,checkin_time=(p_payload->>'checkin_time')::time,checkout_time=(p_payload->>'checkout_time')::time,updated_at=now() where id=p_property;entity:=p_property;
 elsif p_action='late_checkout' then
  select * into strict stay from public.bite_stays where property_id=p_property and id=entity and status='in_house';
  if nullif(p_payload->>'until','') is null or p_payload->>'until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' then raise exception 'Select the India local checkout date and time';end if;
  v_until:=(p_payload->>'until')::timestamp at time zone prop.timezone;
  if v_until<coalesce(stay.standard_checkout_at,(stay.departure+prop.checkout_time) at time zone prop.timezone) or (v_until at time zone prop.timezone)::date<>stay.departure then raise exception 'Use Extend stay for another night; late checkout stays on the departure date';end if;
  if exists(select 1 from public.bite_stays s where s.property_id=p_property and s.room_id=stay.room_id and s.id<>stay.id and s.status in ('reserved','in_house') and s.arrival>=stay.departure and coalesce(s.scheduled_arrival_at,(s.arrival+prop.checkin_time) at time zone prop.timezone)<v_until+make_interval(mins=>coalesce((stay.policy_snapshot->>'turnover_minutes')::integer,30))) then raise exception 'Late checkout conflicts with an incoming booking and cleaning time';end if;
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Record the approved late checkout reason';end if;
  update public.bite_stays set expected_checkout_at=v_until,late_fee_waived=coalesce((p_payload->>'waive_fee')::boolean,false) where id=stay.id;
 elsif p_action='apply_checkout_policy' then
  select * into strict folio from public.bite_folios where property_id=p_property and id=(p_payload->>'folio_id')::uuid and status='open';
  select * into strict stay from public.bite_stays where id=folio.stay_id and status='in_house';folio_id:=folio.id;entity:=folio.id;
  if folio.checkout_policy is not null then result:=jsonb_build_object('id',folio.id,'folio_id',folio.id,'already_complete',true,'policy',folio.checkout_policy);
  else
   q:=private.bite_policy_quote(stay.id,now());
   if p_payload->>'quote_hash' is distinct from q->>'quote_hash' then raise exception 'Policy quote changed. Refresh and review it again';end if;
   if (q->>'early_credit')::numeric>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'discount','room','Reviewed unused-night credit',(q->>'early_credit')::numeric,(q->>'early_credit_tax')::numeric,auth.uid(),'early_checkout');end if;
   if (q->>'late_fee')::numeric>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'charge','room','Reviewed late checkout: '||(q->>'started_late_hours')||' started hours',(q->>'late_fee')::numeric,(q->>'late_tax')::numeric,auth.uid(),'late_checkout');end if;
   update public.bite_folios set checkout_policy=q where id=folio.id;
  end if;
 elsif p_action='task_update' then
  select * into strict task from public.bite_service_tasks where property_id=p_property and id=entity;
  if task.status in ('completed','cancelled') then raise exception 'Task is already finished';end if;
  if task.kind='cleaning' and role_name not in ('owner','manager','housekeeping') then raise exception 'Cleaning staff or manager required' using errcode='42501';end if;
  if task.kind='room_service' and not private.bite_can(p_property,'room_service') then raise exception 'Room service access required' using errcode='42501';end if;
  stat:=p_payload->>'status';v_assignee:=coalesce(nullif(p_payload->>'assigned_to','')::uuid,task.assigned_to);
  if nullif(p_payload->>'assigned_to','') is not null and role_name not in ('owner','manager') then raise exception 'Manager assigns staff' using errcode='42501';end if;
  if v_assignee is not null and not exists(select 1 from public.bite_property_members where property_id=p_property and user_id=v_assignee and active and (role in ('owner','manager') or role=case when task.kind='cleaning' then 'housekeeping' else 'cashier' end)) then raise exception 'Choose active staff from this department/property';end if;
  if task.assigned_to is not null and task.assigned_to<>auth.uid() and role_name not in ('owner','manager') then raise exception 'Task belongs to another staff member' using errcode='42501';end if;
  if stat='assigned' and task.status in ('requested','assigned') and v_assignee is not null then null;
  elsif stat='in_progress' and task.status in ('requested','assigned') then
   if task.kind='cleaning' and (select do_not_disturb from public.bite_rooms where id=task.room_id) then raise exception 'Do Not Disturb is active. Confirm guest permission first';end if;
   v_assignee:=coalesce(v_assignee,auth.uid());
  elsif stat='ready' and task.kind='room_service' and task.status='in_progress' then null;
  elsif stat='completed' and ((task.kind='cleaning' and task.status='in_progress') or (task.kind='room_service' and task.status='ready')) then null;
  else raise exception 'Invalid service task transition';end if;
  update public.bite_service_tasks set status=stat,assigned_to=v_assignee,note=left(coalesce(p_payload->>'note',task.note),250),updated_at=now() where id=task.id;
  if task.kind='cleaning' and stat='in_progress' then update public.bite_rooms set housekeeping='cleaning' where id=task.room_id;end if;
  if task.kind='cleaning' and stat='completed' then update public.bite_rooms set housekeeping='cleaning',cleaning_requested=false,status_note='Cleaning completed; supervisor inspection required' where id=task.room_id;end if;
 elsif p_action='refund_request' then
  folio_id:=(p_payload->>'folio_id')::uuid;
  select * into strict folio from public.bite_folios where property_id=p_property and id=folio_id and status='open';total:=private.bite_folio_totals(folio.id);
  if (p_payload->>'amount')::numeric<>round((p_payload->>'amount')::numeric,2) then raise exception 'Use a two-decimal refund amount';end if;
  amount:=(p_payload->>'amount')::numeric;
  if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) then raise exception 'Enter a finite two-decimal refund amount';end if;
  if amount>greatest(0,-(total->>'balance')::numeric)-coalesce((select sum(r.amount) from public.bite_folio_refund_requests r where r.folio_id=folio.id and r.status in ('requested','processing','failed')),0) then raise exception 'Refund requests exceed the remaining credit';end if;
  insert into public.bite_folio_refund_requests(property_id,folio_id,amount,method,reason,created_by)values(p_property,folio.id,amount,p_payload->>'method',trim(p_payload->>'reason'),auth.uid())returning id into entity;
 elsif p_action='refund_update' then
  select * into strict job from public.bite_folio_refund_requests where property_id=p_property and id=entity;
  if job.status in ('paid','cancelled') then raise exception 'Refund request already finished';end if;
  stat:=p_payload->>'status';folio_id:=job.folio_id;
  if stat='paid' then
   select * into strict folio from public.bite_folios where id=job.folio_id and status='open';total:=private.bite_folio_totals(folio.id);
   if job.amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Credit changed; review before recording the return';end if;
   if length(trim(coalesce(p_payload->>'reference','')))<3 or not coalesce((p_payload->>'return_verified')::boolean,false) then raise exception 'Verify the actual return and record its bank/receipt reference';end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,method,reference,created_by)values(p_property,folio.id,'refund','payment','Refund return recorded by property',job.amount,job.method,left(p_payload->>'reference',100),auth.uid())returning id into v_entry;
   update public.bite_folio_refund_requests set status='paid',entry_id=v_entry,reference=left(p_payload->>'reference',100),updated_at=now() where id=job.id;
  elsif stat in ('processing','failed','cancelled') then update public.bite_folio_refund_requests set status=stat,updated_at=now() where id=job.id;
  else raise exception 'Invalid refund progress';end if;
 elsif p_action='guest_link_revoke' then
  folio_id:=(p_payload->>'folio_id')::uuid;
  update public.bite_guest_folio_links l set revoked_at=now() where l.folio_id=(p_payload->>'folio_id')::uuid and l.property_id=p_property;
  entity:=folio_id;
 elsif p_action='compliance_save' then
  select * into strict stay from public.bite_stays where id=entity and property_id=p_property;
  if not exists(select 1 from public.bite_guests where id=stay.guest_id and (is_oci or lower(trim(country)) not in ('india','indian','bharat','भारत'))) then raise exception 'This checklist is for a foreign/OCI guest';end if;
  insert into public.bite_stay_compliance(stay_id,property_id,travel_document_checked,permission_checked,record_retained_externally,arrived_from,previous_stay,purpose,next_destination,arrival_reference,arrival_reported_at,departure_reference,departure_reported_at,updated_by)
  values(stay.id,p_property,coalesce((p_payload->>'travel_document_checked')::boolean,false),coalesce((p_payload->>'permission_checked')::boolean,false),coalesce((p_payload->>'record_retained_externally')::boolean,false),left(coalesce(p_payload->>'arrived_from',''),120),left(coalesce(p_payload->>'previous_stay',''),250),left(coalesce(p_payload->>'purpose',''),80),left(coalesce(p_payload->>'next_destination',''),250),left(coalesce(p_payload->>'arrival_reference',''),120),case when length(trim(coalesce(p_payload->>'arrival_reference','')))>0 then now()end,left(coalesce(p_payload->>'departure_reference',''),120),case when length(trim(coalesce(p_payload->>'departure_reference','')))>0 then now()end,auth.uid())
  on conflict(stay_id)do update set travel_document_checked=excluded.travel_document_checked,permission_checked=excluded.permission_checked,record_retained_externally=excluded.record_retained_externally,arrived_from=excluded.arrived_from,previous_stay=excluded.previous_stay,purpose=excluded.purpose,next_destination=excluded.next_destination,arrival_reference=excluded.arrival_reference,arrival_reported_at=case when bite_stay_compliance.arrival_reference=excluded.arrival_reference then bite_stay_compliance.arrival_reported_at else excluded.arrival_reported_at end,departure_reference=excluded.departure_reference,departure_reported_at=case when bite_stay_compliance.departure_reference=excluded.departure_reference then bite_stay_compliance.departure_reported_at else excluded.departure_reported_at end,updated_by=auth.uid(),updated_at=now();
 elsif p_action='attach_outlet' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not 'restaurant_menu'=any(prop.capabilities) then raise exception 'Enable Restaurant or Hybrid modules first';end if;
  if not public.has_restaurant_role(rid,array['owner']) or (select count(*) from public.restaurant_members where restaurant_id=rid and role='owner')<>1 or not exists(select 1 from public.restaurants where id=rid and status='Active' and onboarding_status='approved') then raise exception 'One verified owner and an approved active restaurant required' using errcode='42501';end if;
  if exists(select 1 from public.bite_property_outlets where restaurant_id=rid and property_id<>p_property) then raise exception 'This outlet is already assigned to another property';end if;
  insert into public.bite_property_outlets(property_id,restaurant_id)values(p_property,rid)on conflict do nothing;entity:=rid;
 elsif p_action='outlet_application' then
  if not 'restaurant_menu'=any(prop.capabilities) then raise exception 'Choose Restaurant or Hybrid business modules first';end if;
  if exists(select 1 from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property and r.onboarding_status in ('pending','rejected')) then raise exception 'Review the existing application before submitting another';end if;
  if (select count(*) from public.bite_properties where business_id=prop.business_id)>20 or (select count(*) from public.bite_outlet_applications where submitted_by=auth.uid())>=20 then raise exception 'Contact Bite to review additional outlets';end if;
  if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'city',''))) not between 1 and 100 or length(trim(coalesce(p_payload->>'address',''))) not between 3 and 500 or p_payload->>'phone' !~ '^[+0-9 ()-]{7,20}$' then raise exception 'Enter the actual restaurant name, city, address and contact phone';end if;
  rid:=gen_random_uuid();
  insert into public.bite_outlet_applications(restaurant_id,property_id,submitted_by)values(rid,p_property,auth.uid());
  insert into public.restaurants(id,name,city,address,phone,email,contact_person,status,onboarding_status,onboarding_submitted_at,is_published,created_by)
  values(rid,trim(p_payload->>'name'),trim(p_payload->>'city'),trim(p_payload->>'address'),trim(p_payload->>'phone'),(select email from auth.users where id=auth.uid()),left(coalesce(p_payload->>'contact_person',''),120),'Lead added','pending',now(),false,auth.uid());
  insert into public.restaurant_members(restaurant_id,user_id,role)values(rid,auth.uid(),'owner')on conflict do nothing;entity:=rid;
  result:=jsonb_build_object('id',rid,'status','pending','confirmed',true);
 elsif p_action='outlet_application_edit' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not exists(select 1 from public.bite_outlet_applications a join public.restaurants r on r.id=a.restaurant_id where a.property_id=p_property and a.restaurant_id=rid and a.submitted_by=auth.uid() and r.onboarding_status in ('pending','rejected')) then raise exception 'Only your pending/rejected application can be edited' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'address',''))) not between 3 and 500 then raise exception 'Enter the requested name and full address';end if;
  if exists(select 1 from public.restaurant_change_requests where restaurant_id=rid and request_type='profile' and status='Pending') then raise exception 'An existing profile correction is awaiting Admin review';end if;
  insert into public.restaurant_change_requests(restaurant_id,requested_by,request_type,proposed_values)values(rid,auth.uid(),'profile',jsonb_build_object('name',trim(p_payload->>'name'),'address',trim(p_payload->>'address')))returning id into entity;
 elsif p_action='config' then
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
  v_arrival:=(p_payload->>'shift_date')::date;v_lock:=coalesce((p_payload->>'lock_journals')::boolean,false);
  if v_arrival is null or v_arrival>(now() at time zone prop.timezone)::date then raise exception 'Choose a completed/current day';end if;
  select id into v_closing from public.bite_property_shift_closings where property_id=p_property and shift_date=v_arrival;
  if v_closing is not null and (not v_lock or (select locked from public.bite_property_shift_closings where id=v_closing)) then raise exception 'Closing already exists; review its saved snapshot';end if;
  if v_lock then
   for v_key in select distinct hashtextextended('bite.cashbook.day.v1|'||restaurant_id::text||'|'||v_arrival::text,0) from public.bite_property_outlets where property_id=p_property order by 1 loop perform pg_advisory_xact_lock(v_key);end loop;
   if exists(select 1 from public.bite_folio_entries where property_id=p_property and status='pending' and (created_at at time zone prop.timezone)::date=v_arrival) then raise exception 'Verify or void pending hotel receipts before locking the day';end if;
  end if;
  total:=private.bite_property_report(p_property,v_arrival,v_arrival);
  if p_payload->>'source_hash' is distinct from total->>'source_hash' then raise exception 'Ledger changed. Refresh and review before closing';end if;
  amount:=(p_payload->>'opening_cash')::numeric;tax:=(p_payload->>'counted_cash')::numeric;
  if amount is null or tax is null or amount not between 0 and 999999999999.99 or tax not between 0 and 999999999999.99 or amount<>round(amount,2) or tax<>round(tax,2) then raise exception 'Valid opening and counted cash required';end if;
  v_expected_cash:=amount+(total->>'cash_movement')::numeric;
  if v_expected_cash not between 0 and 999999999999.99 then raise exception 'Opening cash insufficient for cash outflows';end if;
  desc_text:=left(trim(coalesce(p_payload->>'notes','')),500);
  if tax<>v_expected_cash and length(desc_text)<8 then raise exception 'Explain the cash difference (at least 8 characters)';end if;
  if v_closing is null then
   insert into public.bite_property_shift_closings(property_id,shift_date,opening_cash,counted_cash,expected_cash,difference,notes,snapshot,created_by)
   values(p_property,v_arrival,amount,tax,v_expected_cash,tax-v_expected_cash,desc_text,total,auth.uid())returning id into v_closing;
  end if;
  if v_lock then update public.bite_property_shift_closings set locked=true,locked_at=now(),locked_by=auth.uid(),lock_review=total||jsonb_build_object('opening_cash',amount,'counted_cash',tax,'expected_cash',v_expected_cash,'difference',tax-v_expected_cash,'notes',desc_text) where id=v_closing;end if;
  entity:=v_closing;
 elsif p_action='pos_sale' then
  rid:=(p_payload->>'restaurant_id')::uuid;
  if not exists(select 1 from public.bite_property_outlets where property_id=p_property and restaurant_id=rid) or not public.has_restaurant_role(rid,array['owner','manager','staff']) then raise exception 'Authorized POS outlet required' using errcode='42501';end if;
  if p_payload->>'channel' not in ('POS - Counter','POS - Dine-in','POS - Takeaway') then raise exception 'Select a POS order type';end if;
  select sum(round((value->>'quantity')::numeric*(value->>'unit_price')::numeric,2)) into amount from jsonb_array_elements(p_payload->'items');
  if (p_payload->>'paid_amount')::numeric is distinct from amount then raise exception 'Dine-in, takeaway and cashier Pay Now bills require full recorded payment. Use room billing for an occupied guest';end if;
  entity:=public.create_pos_order_with_payment(rid,'POS-'||p_request::text,p_payload->>'channel',left(p_payload->>'customer_name',120),left(p_payload->>'customer_phone',20),p_payload->'items',amount,p_payload->>'payment_method',(now() at time zone prop.timezone)::date,p_payload->>'reference',nullif(p_payload->>'table_id','')::uuid);
  result:=jsonb_build_object('id',entity,'order_id',entity,'order_code','POS-'||p_request::text,'confirmed',true);
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
  if coalesce((p_payload->>'cleaning_requested')::boolean,false) then perform private.bite_ensure_cleaning(p_property,entity,(select id from public.bite_stays where room_id=entity and status='in_house' limit 1),coalesce(p_payload->>'note','Stayover cleaning'));end if;
  update public.bite_rooms set do_not_disturb=coalesce((p_payload->>'do_not_disturb')::boolean,false),cleaning_requested=coalesce((p_payload->>'cleaning_requested')::boolean,false),status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='room_status' then
  select * into strict room from public.bite_rooms where id=entity and property_id=p_property;
  stat:=p_payload->>'status';
  if room.do_not_disturb and stat in ('cleaning','ready') then raise exception 'Do Not Disturb is active. Confirm permission before starting cleaning';end if;
  if stat not in ('ready','dirty','cleaning','blocked') then raise exception 'Invalid room status'; end if;
  if stat='ready' and role_name='housekeeping' then raise exception 'Supervisor must inspect and mark Ready' using errcode='42501'; end if;
  if stat='blocked' and role_name not in ('owner','manager') then raise exception 'Manager must block rooms' using errcode='42501'; end if;
  if stat='blocked' and exists(select 1 from public.bite_stays where room_id=entity and status='in_house') then raise exception 'Move guest before blocking occupied room'; end if;
  if stat='ready' then update public.bite_service_tasks set status='completed',updated_at=now() where property_id=p_property and room_id=entity and kind='cleaning' and status not in ('completed','cancelled');end if;
  update public.bite_rooms set housekeeping=stat,cleaning_requested=case when stat='ready' then false else cleaning_requested end,status_note=left(coalesce(p_payload->>'note',''),250) where id=entity;
 elsif p_action='guest_save' then
  if entity is null then
   insert into public.bite_guests(property_id,full_name,phone,country,email,address,id_type,id_last4,is_oci)
   values(p_property,trim(p_payload->>'full_name'),trim(p_payload->>'phone'),coalesce(nullif(trim(p_payload->>'country'),''),'India'),left(coalesce(p_payload->>'email',''),120),left(coalesce(p_payload->>'address',''),500),coalesce(p_payload->>'id_type',''),coalesce(p_payload->>'id_last4',''),coalesce((p_payload->>'is_oci')::boolean,false)) returning id into entity;
  else
   update public.bite_guests set full_name=trim(p_payload->>'full_name'),phone=trim(p_payload->>'phone'),country=coalesce(nullif(trim(p_payload->>'country'),''),'India'),email=left(coalesce(p_payload->>'email',''),120),address=left(coalesce(p_payload->>'address',''),500),id_type=coalesce(p_payload->>'id_type',''),id_last4=coalesce(p_payload->>'id_last4',''),is_oci=coalesce((p_payload->>'is_oci')::boolean,is_oci) where id=entity and property_id=p_property;
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
  perform private.bite_check_room_timing(p_property,room.id,v_arrival,v_departure);
  if nullif(p_payload->>'quote_hash','') is not null then q:=private.bite_reservation_quote(p_property,p_payload||jsonb_build_object('mode',p_payload->>'booking_mode'));if p_payload->>'quote_hash'<>q->>'quote_hash' then raise exception 'Room quote changed. Review the current rates again';end if;end if;
  if room.housekeeping='blocked' then raise exception 'Room is blocked for maintenance'; end if;
  if a>room.adults or c>room.children then raise exception 'Room occupancy limit exceeded'; end if;
  if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(v_arrival,v_departure,'[)')) then raise exception 'Room already reserved for these dates'; end if;
  amount:=coalesce((p_payload->>'nightly_rate')::numeric,room.nightly_rate);
  if amount<>room.nightly_rate and role_name not in ('owner','manager') then raise exception 'Manager approval required for rate override' using errcode='42501'; end if;
  rate:=case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.tax_profile->>'room_rate')::numeric,0) else 0 end;
  cfg:=prop.hotel_policy||jsonb_build_object('checkin_time',prop.checkin_time,'checkout_time',prop.checkout_time,'fee_tax_rate',case when coalesce((prop.tax_profile->>'reviewed')::boolean,false) then coalesce((prop.hotel_policy->>'fee_tax_rate')::numeric,0) else 0 end);
  if p_payload->>'booking_source'='external_booking' and length(trim(coalesce(p_payload->>'booking_reference','')))<3 then raise exception 'Record the external booking reference';end if;
  insert into public.bite_stays(property_id,guest_id,room_id,arrival,departure,adults,children,nightly_rate,room_tax_rate,compliance_note,policy_snapshot,scheduled_arrival_at,standard_checkout_at,expected_checkout_at,booking_source,booking_reference)
  values(p_property,guest,room.id,v_arrival,v_departure,a,c,amount,rate,left(coalesce(p_payload->>'compliance_note',''),250),cfg,(v_arrival+prop.checkin_time) at time zone prop.timezone,(v_departure+prop.checkout_time) at time zone prop.timezone,(v_departure+prop.checkout_time) at time zone prop.timezone,coalesce(p_payload->>'booking_source','walk_in'),left(coalesce(p_payload->>'booking_reference',''),120))returning id into entity;
  insert into public.bite_folios(property_id,stay_id)values(p_property,entity)returning id into folio_id;
  if coalesce((p_payload->>'advance_amount')::numeric,0)<>0 then
   amount:=(p_payload->>'advance_amount')::numeric;
   if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or amount>room.nightly_rate*(v_departure-v_arrival)*(1+rate/100) then raise exception 'Advance exceeds the current room quote or is invalid';end if;
   stat:=case when p_payload->>'advance_method' in ('UPI','Card','Bank Transfer') then 'pending' else 'confirmed' end;
   if coalesce((p_payload->>'advance_verified')::boolean,false) then
    if role_name not in ('owner','manager') or length(trim(coalesce(p_payload->>'advance_reference','')))<3 then raise exception 'Owner/manager bank verification and reference required' using errcode='42501';end if;stat:='confirmed';
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,method,reference,status,created_by)values(p_property,folio_id,'advance','payment','Recorded booking advance; external reference '||left(coalesce(p_payload->>'booking_reference',''),100),amount,p_payload->>'advance_method',left(coalesce(p_payload->>'advance_reference',''),100),stat,auth.uid());
  end if;
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
   perform private.bite_check_room_timing(p_property,room.id,v_arrival,v_departure,stay.id);
   update public.bite_stays set scheduled_arrival_at=(v_arrival+coalesce((stay.policy_snapshot->>'checkin_time')::time,prop.checkin_time))at time zone prop.timezone,standard_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,expected_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,room_id=room.id,arrival=v_arrival,departure=v_departure,adults=a,children=c where id=stay.id;
  elsif p_action='checkin' then
   if stay.status='in_house' then result:=jsonb_build_object('id',stay.id,'folio_id',folio.id,'already_complete',true);
   else
    if stay.status<>'reserved' then raise exception 'Reservation is not available for check-in'; end if;
    if stay.arrival>(now() at time zone prop.timezone)::date then raise exception 'Arrival date is in the future'; end if;
    if stay.departure<=(now() at time zone prop.timezone)::date then raise exception 'Update expired reservation dates before check-in'; end if;
    select * into strict room from public.bite_rooms where id=stay.room_id and property_id=p_property and active;
    if exists(select 1 from public.bite_stays pre where pre.room_id=room.id and pre.id<>stay.id and pre.status in ('reserved','in_house') and pre.departure=stay.arrival and coalesce(pre.expected_checkout_at,(pre.departure+prop.checkout_time)at time zone prop.timezone)>now()) then raise exception 'Resolve the earlier stay before early arrival';end if;
    if room.housekeeping<>'ready' or exists(select 1 from public.bite_stays where room_id=room.id and status='in_house') then raise exception 'Room is occupied or not inspected Ready'; end if;
    update public.bite_stays set status='in_house',checked_in_at=now() where id=stay.id;
    amount:=stay.nightly_rate*(stay.departure-stay.arrival); tax:=round(amount*stay.room_tax_rate/100,2);
    if amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,service_from,service_to,unit_rate) values(p_property,folio.id,'charge','room',(stay.departure-stay.arrival)||' nights · room '||room.number,amount,tax,auth.uid(),stay.arrival,stay.departure,stay.nightly_rate);end if;
    cfg:=stay.policy_snapshot;
    if coalesce((cfg->>'reviewed')::boolean,false) and now()<coalesce(stay.scheduled_arrival_at,(stay.arrival+prop.checkin_time)at time zone prop.timezone) and coalesce((cfg->>'early_checkin_fee')::numeric,0)>0 then
     amount:=(cfg->>'early_checkin_fee')::numeric;
     insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,policy_tag)values(p_property,folio.id,'charge','room','Reviewed early check-in fee',amount,round(amount*coalesce((cfg->>'fee_tax_rate')::numeric,0)/100,2),auth.uid(),'early_checkin');
    end if;
   end if;
  elsif p_action='move' then
   if stay.status not in ('reserved','in_house') then raise exception 'Only an active stay/reservation can move rooms'; end if;
   room_id:=(p_payload->>'room_id')::uuid;
   select * into strict room from public.bite_rooms where id=room_id and property_id=p_property and active and housekeeping<>'blocked';
   perform private.bite_check_room_timing(p_property,room.id,stay.arrival,stay.departure,stay.id);
   if stay.status='in_house' and exists(select 1 from public.bite_stays where room_id=room.id and status='in_house') then raise exception 'Target room is occupied';end if;
   if stay.status='in_house' and room.housekeeping<>'ready' then raise exception 'Target room must be inspected Ready'; end if;
   if room.id=stay.room_id then raise exception 'Select another room'; end if;
   if room.adults<stay.adults or room.children<stay.children then raise exception 'Room occupancy limit exceeded'; end if;
   if exists(select 1 from public.bite_stays s where s.room_id=room.id and s.status in ('reserved','in_house') and daterange(s.arrival,s.departure,'[)') && daterange(stay.arrival,stay.departure,'[)')) then raise exception 'Target room has conflicting stay'; end if;
   if stay.status='in_house' then
    update public.bite_service_tasks set room_id=room.id,updated_at=now() where property_id=p_property and stay_id=stay.id and kind='cleaning' and status not in ('completed','cancelled');
    perform private.bite_ensure_cleaning(p_property,stay.room_id,null,'Room move: clean and inspect');
    update public.bite_rooms d set do_not_disturb=o.do_not_disturb,cleaning_requested=o.cleaning_requested from public.bite_rooms o where d.id=room.id and o.id=stay.room_id;
    update public.bite_rooms set housekeeping='dirty',do_not_disturb=false,cleaning_requested=false where id=stay.room_id;
   end if;
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
   if stay.status='in_house' and amount>0 then insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,created_by,service_from,service_to,unit_rate) values(p_property,folio.id,'charge','room',n||' extra nights',amount,round(amount*stay.room_tax_rate/100,2),auth.uid(),stay.departure,v_departure,v_extension_rate); end if;
   update public.bite_stays set departure=v_departure,nightly_rate=v_extension_rate,standard_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,expected_checkout_at=(v_departure+coalesce((stay.policy_snapshot->>'checkout_time')::time,prop.checkout_time))at time zone prop.timezone,late_fee_waived=false where id=stay.id;
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
   if exists(select 1 from public.bite_service_tasks where stay_id=stay.id and kind='room_service' and status not in ('completed','cancelled')) then raise exception 'Complete or reverse outstanding room-service orders before checkout';end if;
   if exists(select 1 from public.bite_folio_refund_requests where folio_id=folio.id and status in ('requested','processing','failed')) then raise exception 'Resolve the outstanding hotel refund request before checkout';end if;
   if folio.checkout_policy is null and coalesce((stay.policy_snapshot->>'reviewed')::boolean,false) then q:=private.bite_policy_quote(stay.id,now());if (q->>'early_credit')::numeric>0 or (q->>'late_fee')::numeric>0 then raise exception 'Review and apply the agreed checkout policy first';end if;update public.bite_folios set checkout_policy=q where id=folio.id;end if;
   if (total->>'balance')::numeric<>0 or (total->>'deposit_held')::numeric<>0 or (total->>'pending')::numeric<>0 then raise exception 'Settle balance, pending payments and held deposit before checkout'; end if;
   invoice:=jsonb_build_object('number','BITE-'||replace(folio.id::text,'-',''),'issued_at',now(),'property',jsonb_build_object('name',prop.name,'address',prop.address,'phone',prop.phone),'tax_profile',prop.tax_profile,
    'guest',(select jsonb_build_object('name',full_name,'address',address) from public.bite_guests where id=stay.guest_id),'stay',to_jsonb(stay)||jsonb_build_object('status','checked_out','checked_out_at',now()),'room',(select jsonb_build_object('number',number,'room_type',room_type) from public.bite_rooms where id=stay.room_id),'totals',total,
    'entries',(select coalesce(jsonb_agg((to_jsonb(e)-'created_by')||jsonb_build_object('source_items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.item_name,'quantity',i.quantity,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=e.source_order_id)) order by e.created_at),'[]'::jsonb) from public.bite_folio_entries e where e.folio_id=folio.id));
   invoice:=invoice||jsonb_build_object('splits',private.bite_split_invoice(invoice,folio.payer_split));
   update public.bite_folios set status='settled',settled_at=now(),invoice_number=invoice->>'number',invoice_snapshot=invoice where id=folio.id;
   update public.bite_stays set status='checked_out',checked_out_at=now() where id=stay.id;
   update public.bite_rooms set housekeeping='dirty',do_not_disturb=false,cleaning_requested=false where id=stay.room_id;
   update public.bite_service_tasks set status='cancelled',updated_at=now() where stay_id=stay.id and kind='cleaning' and status not in ('completed','cancelled');
   perform private.bite_ensure_cleaning(p_property,stay.room_id,null,'Checkout: clean and inspect');
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
     -- The matching folio proof is inserted before the coordinated update below.
    end if;
   else order_id:=(p_payload->>'order_id')::uuid; end if;
   select * into strict ord from public.orders where id=order_id for update;
   if not exists(select 1 from public.bite_property_outlets o where o.property_id=p_property and o.restaurant_id=ord.restaurant_id) or not public.has_restaurant_role(ord.restaurant_id,array['owner','manager','staff']) then raise exception 'Order belongs to another property/outlet' using errcode='42501'; end if;
   if ord.channel not like 'POS - %' or ord.status in ('Cancelled','Rejected') or ord.is_demo then raise exception 'Only genuine POS sales can be charged to room'; end if;
   if ord.restaurant_customer_id is not null or (ord.waived_off_amount<>0 and p_action<>'room_pos') or exists(select 1 from public.restaurant_order_payments where order_id=ord.id) or exists(select 1 from public.restaurant_order_refunds where order_id=ord.id) then raise exception 'Paid, Khata-linked, adjusted or refunded POS sale cannot be posted'; end if;
   if exists(select 1 from public.bite_folio_entries where source_order_id=ord.id) then raise exception 'POS sale already posted to a folio'; end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,source_order_id,created_by)
   values(p_property,folio.id,'charge','food','POS '||ord.order_code||case when p_action='room_pos' and coalesce((p_payload->>'discount')::numeric,0)>0 then ' · discount '||(p_payload->>'discount')||': '||left(p_payload->>'discount_reason',60) else '' end,ord.amount-case when p_action='room_pos' then coalesce((p_payload->>'discount')::numeric,0) else 0 end,ord.id,auth.uid()) returning id into entity;
   if p_action='room_pos' and coalesce((p_payload->>'discount')::numeric,0)>0 then update public.orders set waived_off_amount=(p_payload->>'discount')::numeric where id=ord.id;end if;
   if p_action='room_pos' and p_payload->>'fulfilment'='room_service' then
    if not private.bite_can(p_property,'room_service') then raise exception 'Room service disabled' using errcode='42501';end if;
    insert into public.bite_service_tasks(property_id,kind,room_id,stay_id,order_id,note,created_by)values(p_property,'room_service',stay.room_id,stay.id,ord.id,left(coalesce(p_payload->>'service_note',''),250),auth.uid());
   end if;
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
    update public.bite_service_tasks set status='cancelled',updated_at=now() where order_id=entry.source_order_id and kind='room_service';
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
    if exists(select 1 from public.bite_folio_refund_requests where folio_id=folio.id and status in ('requested','processing','failed')) then raise exception 'Use the existing refund request to record this return';end if;
    if amount>greatest(0,-(total->>'balance')::numeric) then raise exception 'Only existing overpayment/credit can be recorded as refunded'; end if;
   end if;
   insert into public.bite_folio_entries(property_id,folio_id,kind,category,description,amount,tax_amount,status,method,reference,created_by)
   values(p_property,folio.id,kind,case when kind in ('deposit_hold','deposit_return','deposit_apply') then 'deposit' when kind in ('payment','advance','refund') then 'payment' else case when kind='discount' and p_payload->>'category'='room' then 'room' else 'incidental' end end,desc_text,amount,tax,stat,p_payload->>'method',left(coalesce(p_payload->>'reference',''),100),auth.uid()) returning id into entity;
  else raise exception 'Unknown property action'; end if;
 end if;
 result:=coalesce(result,jsonb_build_object('id',entity,'folio_id',folio_id,'confirmed',true));
 insert into public.bite_property_commands values(p_property,p_request,p_action,p_payload,result,auth.uid(),now());
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),p_action,entity,p_request);
 return result;
end $$;

