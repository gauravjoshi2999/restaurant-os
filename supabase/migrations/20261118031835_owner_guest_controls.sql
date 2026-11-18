-- Two required IDs per family; optional additional IDs and one allocated group advance.
-- Atomic, idempotent family / multi-room check-in on the existing hotel ledger.
-- No new guest-payment ledger; every selected room retains its own stay and folio.
-- Existing private.bite_property_command remains the sole allocation, tax and POS guard.
create or replace function public.bite_family_booking(
 p_property uuid, p_payload jsonb, p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_property public.bite_properties;
 v_prior public.bite_property_commands;
 v_group uuid;
 v_lead uuid;
 v_guest uuid;
 v_result jsonb;
 v_booking jsonb;
 v_unit jsonb;
 v_room uuid;
 v_seen uuid[]:='{}'::uuid[];
 v_mode text;
 v_name text;
 v_stays jsonb:='[]'::jsonb;
 v_index integer:=0;
 v_count integer;
 v_total_adults integer:=0;
 v_family_ids jsonb;
 v_person jsonb;
 v_side text;
 v_advance numeric:=coalesce((p_payload->>'advance_amount')::numeric,0);
 v_allocation numeric;
begin
 if v_actor is null or p_request is null or p_payload is null
    or jsonb_typeof(p_payload)<>'object' then
  raise exception 'Login and a stable booking request are required' using errcode='42501';
 end if;
 if not private.bite_can(p_property,'reservations')
    or not private.bite_can(p_property,'guest_register')
    or not private.bite_can(p_property,'folios') then
  raise exception 'This property role cannot create family check-ins' using errcode='42501';
 end if;
 -- Serialize all allocations and retries with the existing per-property command lock.
 select * into v_property from public.bite_properties where id=p_property for update;
 if not found then raise exception 'Property not found'; end if;
 select * into v_prior from public.bite_property_commands
 where property_id=p_property and request_id=p_request;
 if found then
  if v_prior.action<>'family_booking' or v_prior.payload<>p_payload or v_prior.created_by<>v_actor then
   raise exception 'Request ID already used with different booking details' using errcode='42501';
  end if;
  return v_prior.result;
 end if;
 v_mode:=coalesce(p_payload->>'mode','');
 if v_mode not in ('checkin','reserve') then raise exception 'Select Check in now or Reserve for later'; end if;
 v_name:=trim(coalesce(p_payload->>'name',''));
 if length(v_name) not between 1 and 120 then raise exception 'Family name must be 1 to 120 characters'; end if;
 if jsonb_typeof(p_payload->'rooms') is distinct from 'array' then
  raise exception 'Choose rooms for this family booking';
 end if;
 v_count:=jsonb_array_length(p_payload->'rooms');
 if v_count not between 2 and 15 then raise exception 'Select 2 to 15 rooms for one family booking'; end if;
 v_lead:=(p_payload->>'guest_id')::uuid;
 if not exists(select 1 from public.bite_guests where id=v_lead and property_id=p_property) then
  raise exception 'Lead guest belongs to another property or was not saved' using errcode='42501';
 end if;
 if v_mode='checkin' and (p_payload->>'arrival')::date<>(now() at time zone v_property.timezone)::date then
  raise exception 'For another arrival date choose Reserve for later';
 end if;
 if v_advance<0 or v_advance<>round(v_advance,2) then raise exception 'Enter a valid family advance'; end if;
 -- Front-end validation is only a convenience. Never permit direct API callers
 -- to bypass the family photo-ID requirement on an immediate check-in.
 if v_mode='checkin' then
  for v_unit in select value from jsonb_array_elements(p_payload->'rooms') loop
   v_total_adults:=v_total_adults+coalesce((v_unit->>'adults')::integer,0);
   if jsonb_typeof(v_unit->'registration')<>'object'
      or nullif(v_unit->'registration'->>'id_front','') is null
      or nullif(v_unit->'registration'->>'id_back','') is null then
    raise exception 'Verify guest ID front and back for every selected room';
   end if;
  end loop;
  v_family_ids:=p_payload->'rooms'->0->'registration'->'family_guest_ids';
  if jsonb_typeof(v_family_ids) is distinct from 'array'
     or jsonb_array_length(v_family_ids)<greatest(0,least(2,v_total_adults)-1)
     or jsonb_array_length(v_family_ids)>39 then
   raise exception 'Verify 2 guest IDs for the family; additional IDs are optional';
  end if;
  if (select count(distinct x->>'subject_key') from jsonb_array_elements(v_family_ids)x)
     <>jsonb_array_length(v_family_ids) then
   raise exception 'Duplicate family guest ID subject';
  end if;
  for v_person in select value from jsonb_array_elements(v_family_ids) loop
   if nullif(v_person->>'subject_key','') is null or length(trim(coalesce(v_person->>'name','')))<1 then
    raise exception 'Name and ID subject are required for each additional adult';
   end if;
   foreach v_side in array array['front','back'] loop
    if not exists(select 1 from public.bite_guest_documents d
      where d.property_id=p_property and d.guest_id=v_lead
        and d.subject_key=(v_person->>'subject_key')::uuid
        and d.id=(v_person->>('id_'||v_side))::uuid
        and d.status='ready' and d.kind='masked_id') then
     raise exception 'A family guest ID photo is missing or unverified';
    end if;
   end loop;
  end loop;
 end if;
 -- Group created in the same transaction as every room reservation/check-in.
 -- Any full-room, date, capacity, tax or access failure rolls back the WHOLE group.
 insert into public.bite_booking_groups(property_id,name,payer_guest_id)
 values(p_property,v_name,v_lead) returning id into v_group;
 for v_unit in select value from jsonb_array_elements(p_payload->'rooms') loop
  v_index:=v_index+1;
  if jsonb_typeof(v_unit)<>'object' then raise exception 'Room % details are missing',v_index;end if;
  v_room:=(v_unit->>'room_id')::uuid;
  if v_room is null or v_room=any(v_seen) then raise exception 'A room was selected twice or is missing';end if;
  v_seen:=array_append(v_seen,v_room);
  v_guest:=coalesce(nullif(v_unit->>'guest_id','')::uuid,v_lead);
  if not exists(select 1 from public.bite_guests where id=v_guest and property_id=p_property) then
   raise exception 'Room guest belongs to another property' using errcode='42501';
  end if;
  if (v_unit->>'nightly_rate')::numeric is null
   or (v_unit->>'nightly_rate')::numeric<0
   or (v_unit->>'nightly_rate')::numeric>9999999999.99
   or (v_unit->>'nightly_rate')::numeric<>round((v_unit->>'nightly_rate')::numeric,2) then
   raise exception 'Invalid agreed nightly room rate in room %',v_index;
  end if;
  v_booking:=jsonb_build_object(
   'guest_id',v_guest,
   'room_id',v_room,
   'arrival',p_payload->>'arrival',
   'departure',p_payload->>'departure',
   'adults',v_unit->'adults',
   'children',coalesce(v_unit->'children','0'::jsonb),
   'nightly_rate',v_unit->'nightly_rate',
   'booking_source',coalesce(p_payload->>'booking_source','walk_in'),
   'booking_reference',coalesce(p_payload->>'booking_reference',''),
   'booking_mode',v_mode,
   'arrival_time',coalesce(p_payload->>'arrival_time',''),
   'terms_at_checkin',true,
   'compliance_note',left(trim(coalesce(v_unit->>'note','')),250)
  );
  if v_unit ? 'quote_hash' and nullif(v_unit->>'quote_hash','') is not null then
   v_booking:=v_booking||jsonb_build_object('quote_hash',v_unit->>'quote_hash');
  end if;
  if v_unit ? 'registration' then
   v_booking:=v_booking||jsonb_build_object('registration',v_unit->'registration');
  elsif v_index=1 and p_payload ? 'registration' then
   v_booking:=v_booking||jsonb_build_object('registration',p_payload->'registration');
  end if;
  v_allocation:=least(v_advance,round((v_unit->>'nightly_rate')::numeric*((p_payload->>'departure')::date-(p_payload->>'arrival')::date)*(1+case when coalesce((v_property.tax_profile->>'reviewed')::boolean,false) then coalesce((v_property.tax_profile->>'room_rate')::numeric,0) else 0 end/100),2));
  if v_allocation>0 then
   v_booking:=v_booking||jsonb_build_object('advance_amount',v_allocation,'advance_method',coalesce(p_payload->>'advance_method','Cash'),'advance_reference',coalesce(p_payload->>'advance_reference',''),'advance_verified',coalesce((p_payload->>'advance_verified')::boolean,false),'advance_account',coalesce(p_payload->>'advance_account',''));
   v_advance:=v_advance-v_allocation;
  end if;
  v_result:=public.bite_property_command(p_property,'reserve',v_booking,gen_random_uuid());
  update public.bite_stays set group_id=v_group
  where property_id=p_property and id=(v_result->>'id')::uuid;
  if v_mode='checkin' then
   perform public.bite_property_command(
    p_property,'checkin',jsonb_build_object('id',v_result->>'id'),gen_random_uuid()
   );
  end if;
  v_stays:=v_stays||jsonb_build_array(jsonb_build_object(
   'id',v_result->>'id','folio_id',v_result->>'folio_id','room_id',v_room,
   'status',case when v_mode='checkin' then 'in_house' else 'reserved' end
  ));
 end loop;
 if v_advance>0 then raise exception 'Family advance exceeds the combined room rent';end if;
 v_result:=jsonb_build_object('id',v_group,'mode',v_mode,'stays',v_stays,'confirmed',true);
 insert into public.bite_property_commands(property_id,request_id,action,payload,result,created_by)
 values(p_property,p_request,'family_booking',p_payload,v_result,v_actor);
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
 values(p_property,v_actor,'family_booking',v_group,p_request);
 return v_result;
end;
$$;
revoke all on function public.bite_family_booking(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.bite_family_booking(uuid,jsonb,uuid) to authenticated;

-- Per-person permissions are owned by the hotel owner; ordinary staff start with entry access.
create table public.bite_property_staff_permissions (
 property_id uuid not null,user_id uuid not null,permissions text[] not null,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(property_id,user_id),foreign key(property_id,user_id) references public.bite_property_members(property_id,user_id) on delete cascade
);
alter table public.bite_property_staff_permissions enable row level security;
revoke all on public.bite_property_staff_permissions from public,anon,authenticated;
grant select on public.bite_property_staff_permissions to authenticated;
create policy staff_permissions_read on public.bite_property_staff_permissions for select to authenticated
 using(user_id=(select auth.uid()) or private.bite_property_role(property_id)='owner');

create function private.bite_staff_defaults(p_role text) returns text[] language sql immutable set search_path='' as $$
 select case when p_role in('manager','receptionist') then array['hotel_rooms','guest_register','reservations','folios','hotel_incidentals','guest_entry','reservation_entry','checkin']
 when p_role='cashier' then array['restaurant_pos','restaurant_menu','dine_in','takeaway','pos_entry','payment_entry']
 when p_role='housekeeping' then array['hotel_rooms','housekeeping','housekeeping_work']
 when p_role='accountant' then array['reporting','folios','expenses'] else '{}'::text[] end
$$;
create function private.bite_staff_permissions(p_property uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((select coalesce(s.permissions,private.bite_staff_defaults(m.role)) from public.bite_property_members m
 left join public.bite_property_staff_permissions s using(property_id,user_id)
 where m.property_id=p_property and m.user_id=(select auth.uid()) and m.active and not public.is_platform_admin()),'{}'::text[])
$$;
create function private.bite_staff_can(p_property uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(private.bite_property_role(p_property)='owner' or
 (private.bite_property_role(p_property) is not null and p_permission=any(private.bite_staff_permissions(p_property))),false)
$$;
create or replace function private.bite_can(p_property uuid,p_capability text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select case when p_capability='manage_modules' then private.bite_property_role(p_property)='owner'
 when p_capability='membership' then private.bite_property_role(p_property) is not null
 else p_capability=any(p.capabilities) and private.bite_staff_can(p_property,p_capability) end
 from public.bite_properties p where p.id=p_property),false)
$$;

create function private.bite_assert_staff_action(p_property uuid,p_action text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare permission text;
begin
 if auth.uid() is null or private.bite_property_role(p_property) is null then raise exception 'Property access denied' using errcode='42501';end if;
 -- Permission changes and commands lock the same property, so revocation cannot race a write.
 perform 1 from public.bite_properties where id=p_property for update;
 if private.bite_property_role(p_property)='owner' then return;end if;
 permission:=case
 when p_action='guest_save' then 'guest_entry'
 when p_action in('reserve','reserve_group') then 'reservation_entry'
 when p_action='checkin' then 'checkin'
 when p_action in('reservation_edit','move','extend','cancel','no_show','compliance_save') then 'stay_manage'
 when p_action in('checkout','checkout_collect','booking_checkout_collect','apply_checkout_policy','payer_split','split_bill','late_checkout') then 'checkout'
 when p_action='booking_bill' then 'folios'
 when p_action in('payment','deposit_hold','deposit_apply','deposit_return') then 'payment_entry'
 when p_action in('payment_confirm','payment_void','account_note') then 'payment_verify'
 when p_action in('charge','room_post','room_pos','room_reconcile') then 'room_charge'
 when p_action='pos_sale' then 'pos_entry'
 when p_action in('discount','reverse') then 'discount'
 when p_action in('refund','refund_request','refund_decide') then 'refund'
 when p_action='room_save' then 'room_manage'
 when p_action in('room_status','room_privacy') then 'housekeeping_work'
 when p_action='task_update' then case when exists(select 1 from public.bite_service_tasks where property_id=p_property and id=(p_payload->>'id')::uuid and kind='room_service') then 'room_service_work' else 'housekeeping_work' end
 when p_action='expense' then 'expense_entry'
 when p_action='daybook_entry' then 'daybook_entry'
 when p_action='close_shift' then 'close_day'
 when p_action='abandon_checkin' then 'reservation_entry'
 else 'owner_only' end;
 if not private.bite_staff_can(p_property,permission) then raise exception 'Owner has not allowed this action: %',p_action using errcode='42501';end if;
 if p_action='reserve' and coalesce((p_payload->>'advance_amount')::numeric,0)>0 and not private.bite_staff_can(p_property,'payment_entry') then raise exception 'Owner permission required to record an advance' using errcode='42501';end if;
 if p_action in('reserve','payment','checkout_collect') and coalesce((p_payload->>'advance_verified')::boolean,(p_payload->>'verified')::boolean,false) and not private.bite_staff_can(p_property,'payment_verify') then raise exception 'Owner permission required to verify a bank receipt' using errcode='42501';end if;
end $$;
alter function private.bite_property_command(uuid,text,jsonb,uuid) rename to bite_property_command_before_staff_permissions;
alter function private.bite_hotel_account_command(uuid,text,jsonb,uuid) rename to bite_hotel_account_command_before_staff_permissions;
revoke all on function private.bite_property_command_before_staff_permissions(uuid,text,jsonb,uuid),private.bite_hotel_account_command_before_staff_permissions(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);
 return private.bite_property_command_before_staff_permissions(p_property,p_action,p_payload,p_request);
end $$;
create function private.bite_hotel_account_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);
 return private.bite_hotel_account_command_before_staff_permissions(p_property,p_action,p_payload,p_request);
end $$;

-- Context is recomputed from stored grants on each request; no user-editable JWT claims.
alter function private.bite_owner_context() rename to bite_owner_context_before_staff_permissions;
revoke all on function private.bite_owner_context_before_staff_permissions() from public,anon,authenticated;
create function private.bite_owner_context() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x||jsonb_build_object('permissions',private.bite_staff_permissions((x->>'id')::uuid),'can_delete_data',x->>'role'='owner')),'[]'::jsonb)
 from jsonb_array_elements(private.bite_owner_context_before_staff_permissions()) x
$$;
alter function private.bite_hotel_workspace(uuid) rename to bite_hotel_workspace_before_staff_permissions;
revoke all on function private.bite_hotel_workspace_before_staff_permissions(uuid) from public,anon,authenticated;
create function private.bite_hotel_workspace(p_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;begin
 v:=private.bite_hotel_workspace_before_staff_permissions(p_property);
 if private.bite_property_role(p_property)='owner' then
  v:=v||jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'active',m.active,'email',u.email,
  'display_name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Staff account'),'permissions',coalesce(s.permissions,private.bite_staff_defaults(m.role)))),'[]'::jsonb)
  from public.bite_property_members m join auth.users u on u.id=m.user_id left join public.bite_property_staff_permissions s using(property_id,user_id) where m.property_id=p_property));
 end if;
 return v;
end $$;



create function private.bite_save_staff_access(p_property uuid,p_user uuid,p_email text,p_role text,p_active boolean,p_permissions text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;uid uuid;perms text[]:=coalesce(p_permissions,'{}'::text[]);rid uuid;allowed text[];
begin
 if auth.uid() is null or private.bite_property_role(p_property) is distinct from 'owner' then raise exception 'Only the hotel owner can decide staff access' using errcode='42501';end if;
 perform 1 from public.bite_properties where id=p_property for update;
 allowed:=private.bite_default_capabilities('hybrid')||array['guest_entry','reservation_entry','checkin','stay_manage','checkout','payment_entry','payment_verify','room_charge','pos_entry','orders_manage','discount','refund','room_manage','housekeeping_work','room_service_work','expense_entry','daybook_entry','close_day','menu_manage','stock_entry','staff_entry','salary_manage'];
 if not perms<@allowed or array_position(perms,null) is not null then raise exception 'Unknown staff permission';end if;
 if p_role not in('manager','receptionist','cashier','housekeeping','accountant') then raise exception 'Choose a staff role';end if;
 -- Automatically include the screens needed to perform each explicitly enabled task.
 if perms&&array['guest_entry','reservation_entry','checkin','stay_manage'] then perms:=perms||array['hotel_rooms','guest_register','reservations','folios'];end if;
 if perms&&array['checkout','payment_entry','payment_verify','room_charge','discount','refund'] then perms:=perms||array['hotel_rooms','guest_register','reservations','folios'];end if;
 if perms&&array['pos_entry','room_charge'] then perms:=perms||array['restaurant_pos','restaurant_menu','dine_in','takeaway'];end if;
 if 'room_charge'=any(perms) then perms:=perms||array['charge_to_room','hotel_incidentals'];end if;
 if 'orders_manage'=any(perms) then perms:=perms||array['online_food_orders'];end if;
 if 'menu_manage'=any(perms) then perms:=perms||array['restaurant_menu'];end if;
 if 'expense_entry'=any(perms) then perms:=perms||array['expenses'];end if;
 if perms&&array['daybook_entry','close_day'] then perms:=perms||array['reporting'];end if;
 if 'room_manage'=any(perms) then perms:=perms||array['hotel_rooms','housekeeping'];end if;
 if 'housekeeping_work'=any(perms) then perms:=perms||array['hotel_rooms','housekeeping'];end if;
 if 'room_service_work'=any(perms) then perms:=perms||array['room_service'];end if;
 if 'stock_entry'=any(perms) then perms:=perms||array['inventory'];end if;
 if perms&&array['staff_entry','salary_manage'] then perms:=perms||array['staff_management'];end if;
 select coalesce(array_agg(distinct x),'{}'::text[]) into perms from unnest(perms)x;
 v:=public.bite_property_command(p_property,'member',jsonb_build_object('id',p_user,'email',trim(p_email),'role',p_role,'active',p_active),gen_random_uuid());
 uid:=(v->>'id')::uuid;
 insert into public.bite_property_staff_permissions(property_id,user_id,permissions,updated_by) values(p_property,uid,perms,auth.uid())
 on conflict(property_id,user_id) do update set permissions=excluded.permissions,updated_by=excluded.updated_by,updated_at=now();
 -- Keep outlet assignments inside the same transaction. Revoking property access
 -- revokes non-owner outlet access too, including a previously assigned manager.
 for rid in select restaurant_id from public.bite_property_outlets where property_id=p_property loop
  if not p_active or not perms&&array['restaurant_pos','restaurant_menu','online_food_orders','inventory','staff_management','reporting','expenses'] then
   delete from public.restaurant_members where restaurant_id=rid and user_id=uid and role in('manager','staff');
   delete from public.bite_cashier_outlet_grants where property_id=p_property and restaurant_id=rid and user_id=uid;
  end if;
 end loop;
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),'staff_permissions_saved',uid,gen_random_uuid());
 return jsonb_build_object('id',uid,'permissions',perms,'active',p_active);
end $$;

create function public.bite_save_staff_access(p_property uuid,p_user uuid,p_email text,p_role text,p_active boolean,p_permissions text[]) returns jsonb
language sql security invoker set search_path='' as $$ select private.bite_save_staff_access(p_property,p_user,p_email,p_role,p_active,p_permissions) $$;

-- The opaque guest-document store keeps its existing protected byte transport.
-- Staff may add copies for entry, while permanent removal remains owner-only.
alter function private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb) rename to bite_guest_document_command_before_staff_permissions;
revoke all on function private.bite_guest_document_command_before_staff_permissions(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
create function private.bite_guest_document_command(p_property uuid,p_guest uuid,p_document uuid,p_action text,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if p_action='forget' and private.bite_property_role(p_property) is distinct from 'owner' then raise exception 'Only the owner can delete a saved ID copy' using errcode='42501';end if;
 if p_action in('begin','finish') and not private.bite_staff_can(p_property,'guest_entry') then raise exception 'Owner permission required for guest ID entry' using errcode='42501';end if;
 return private.bite_guest_document_command_before_staff_permissions(p_property,p_guest,p_document,p_action,p_details);
end $$;
-- Storage DELETE is checked independently of the command that forgets metadata.
create policy guest_docs_owner_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'bite-guest-documents' or exists(select 1 from public.bite_guest_documents d where d.object_path=name and private.bite_property_role(d.property_id)='owner'));

create function private.bite_restaurant_staff_can(p_restaurant uuid,p_permission text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare pid uuid;m public.bite_property_members;begin
 if auth.uid() is null or public.is_platform_admin() then return true;end if;
 if exists(select 1 from public.restaurant_members where restaurant_id=p_restaurant and user_id=auth.uid() and role='owner') then return true;end if;
 select o.property_id into pid from public.bite_property_outlets o join public.bite_property_members mm on mm.property_id=o.property_id and mm.user_id=auth.uid() where o.restaurant_id=p_restaurant limit 1;
 if pid is null then return true;end if; -- existing independent restaurant access is unchanged
 select * into m from public.bite_property_members where property_id=pid and user_id=auth.uid();
 return m.active and private.bite_staff_can(pid,p_permission);
end $$;
create function private.bite_guard_restaurant_staff() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;rid uuid;oid uuid;pid uuid;permission text;
begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 rid:=case when TG_TABLE_NAME='restaurants' then (row_data->>'id')::uuid else nullif(row_data->>'restaurant_id','')::uuid end;
 if rid is null then oid:=nullif(row_data->>'order_id','')::uuid;select restaurant_id into rid from public.orders where id=oid;end if;
 if rid is null and TG_TABLE_NAME='restaurant_purchase_items' then execute 'select restaurant_id from public.restaurant_purchases where id=$1' into rid using (row_data->>'purchase_id')::uuid;end if;
 if rid is null then if TG_OP='DELETE' then return old;else return new;end if;end if;
 if TG_OP='INSERT' and oid is not null and exists(select 1 from public.orders where id=oid and customer_id=auth.uid() and coalesce(channel,'') not like 'POS - %') then return new;end if;
 -- Ordinary customers can still place and read their own food orders.
 if TG_TABLE_NAME='orders' and TG_OP='INSERT' and nullif(row_data->>'customer_id','')::uuid=auth.uid() then if TG_OP='DELETE' then return old;else return new;end if;end if;
 select o.property_id into pid from public.bite_property_outlets o join public.bite_property_members m on m.property_id=o.property_id and m.user_id=auth.uid() where o.restaurant_id=rid limit 1;
 if pid is not null and private.bite_property_role(pid) is distinct from 'owner'
 and not exists(select 1 from public.restaurant_members where restaurant_id=rid and user_id=auth.uid() and role='owner') then
  perform 1 from public.bite_properties where id=pid for update;
  if TG_OP='DELETE' then raise exception 'Only the hotel owner can delete records' using errcode='42501';end if;
  permission:=TG_ARGV[0];
  if TG_TABLE_NAME='orders' then permission:=case when coalesce(row_data->>'channel','') like 'POS - %' then 'pos_entry' else 'orders_manage' end;end if;
  if not private.bite_restaurant_staff_can(rid,permission) then raise exception 'Owner has not allowed this operation' using errcode='42501';end if;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;

-- Defense in depth for direct table APIs and legacy SQL functions, including DELETE.
do $permissions$
declare spec record;begin
 for spec in select * from (values
 ('orders','online_food_orders','orders_manage'),('order_items','restaurant_pos','pos_entry'),
 ('restaurant_order_payments','restaurant_pos','payment_entry'),('restaurant_order_refunds','restaurant_pos','refund'),('restaurant_order_adjustments','restaurant_pos','discount'),
 ('menu_items','restaurant_menu','menu_manage'),('menu_categories','restaurant_menu','menu_manage'),
 ('restaurant_expenses','expenses','expense_entry'),('restaurant_purchases','inventory','stock_entry'),('restaurant_purchase_items','inventory','stock_entry'),
 ('restaurant_inventory_items','inventory','stock_entry'),('restaurant_stock_movements','inventory','stock_entry'),
 ('restaurant_cashbook_manual_entries','reporting','daybook_entry'),('restaurant_cashbook_closings','reporting','close_day'),
 ('restaurant_employees','staff_management','staff_entry'),('restaurant_employee_attendance','staff_management','staff_entry'),('restaurant_employee_leaves','staff_management','staff_entry'),('restaurant_employee_payments','staff_management','salary_manage'),
 ('restaurant_customers','restaurant_pos','pos_entry'),('restaurant_customer_ledger_entries','restaurant_pos','payment_entry'),
 ('restaurant_tables','dine_in','owner_only'),('restaurant_pos_drafts','restaurant_pos','pos_entry'),
 ('restaurants','restaurant_menu','owner_only'),('restaurant_members','staff_management','owner_only'),
 ('restaurant_delivery_zones','online_food_orders','owner_only'),('restaurant_delivery_zone_pincodes','online_food_orders','owner_only'),
 ('restaurant_payout_profiles','reporting','owner_only'),('restaurant_pos_visit_details','restaurant_pos','pos_entry'),('bite_pos_bill_service','restaurant_pos','pos_entry')
 ) as x(table_name,module,write_permission) loop
  if to_regclass('public.'||spec.table_name) is null then continue;end if;
  execute format('create trigger bite_staff_operation before insert or update or delete on public.%I for each row execute function private.bite_guard_restaurant_staff(%L)',spec.table_name,spec.write_permission);
  if spec.table_name in('menu_items','menu_categories') then continue;end if; -- public menu browsing remains available to staff as customers
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=spec.table_name and column_name='restaurant_id') then
   if spec.table_name='restaurant_members' then
    execute 'create policy bite_staff_read_boundary on public.restaurant_members as restrictive for select to authenticated using(user_id=(select auth.uid()) or private.bite_restaurant_staff_can(restaurant_id,''staff_management''))';
   elsif spec.table_name='orders' then
    execute 'create policy bite_staff_read_boundary on public.orders as restrictive for select to authenticated using(customer_id=(select auth.uid()) or private.bite_restaurant_staff_can(restaurant_id,case when channel like ''POS - %'' then ''restaurant_pos'' else ''online_food_orders'' end))';
   else
    execute format('create policy bite_staff_read_boundary on public.%I as restrictive for select to authenticated using(private.bite_restaurant_staff_can(restaurant_id,%L))',spec.table_name,spec.module);
   end if;
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name=spec.table_name and column_name='order_id') then
   execute format('create policy bite_staff_read_boundary on public.%I as restrictive for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=(select auth.uid()) or private.bite_restaurant_staff_can(o.restaurant_id,case when o.channel like ''POS - %%'' then ''restaurant_pos'' else ''online_food_orders'' end))))',spec.table_name);
  elsif spec.table_name='restaurant_purchase_items' then
   execute 'create policy bite_staff_read_boundary on public.restaurant_purchase_items as restrictive for select to authenticated using(exists(select 1 from public.restaurant_purchases r where r.id=purchase_id and private.bite_restaurant_staff_can(r.restaurant_id,''inventory'')))';
  end if;
 end loop;
end $permissions$;

revoke all on function private.bite_staff_defaults(text),private.bite_staff_permissions(uuid),private.bite_staff_can(uuid,text),private.bite_assert_staff_action(uuid,text,jsonb),private.bite_guard_restaurant_staff(),private.bite_restaurant_staff_can(uuid,text),private.bite_save_staff_access(uuid,uuid,text,text,boolean,text[]) from public,anon,authenticated;
grant execute on function private.bite_staff_defaults(text),private.bite_staff_permissions(uuid),private.bite_staff_can(uuid,text),private.bite_restaurant_staff_can(uuid,text),private.bite_save_staff_access(uuid,uuid,text,text,boolean,text[]),private.bite_property_command(uuid,text,jsonb,uuid),private.bite_hotel_account_command(uuid,text,jsonb,uuid),private.bite_owner_context(),private.bite_hotel_workspace(uuid),private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb) to authenticated;
revoke all on function private.bite_property_command(uuid,text,jsonb,uuid),private.bite_hotel_account_command(uuid,text,jsonb,uuid),private.bite_owner_context(),private.bite_hotel_workspace(uuid),private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb) from public,anon;
revoke all on function public.bite_save_staff_access(uuid,uuid,text,text,boolean,text[]) from public,anon;
grant execute on function public.bite_save_staff_access(uuid,uuid,text,text,boolean,text[]) to authenticated;


-- Restrict existing definer report/invoice RPCs, in addition to table RLS.
do $reports$declare def text;begin
 if to_regprocedure('public.bite_pos_reports_v1(uuid,date,date)') is not null then
  select pg_get_functiondef('public.bite_pos_reports_v1(uuid,date,date)'::regprocedure) into def;
  def:=regexp_replace(def,'\mbegin\M',E'begin\n if not private.bite_restaurant_staff_can(p_restaurant_id,''restaurant_pos'') then raise exception ''Owner has not allowed POS reports'' using errcode=''42501'';end if;', 'i');
  execute def;
 end if;
 if to_regprocedure('public.bite_customer_invoice(uuid)') is not null then
  select pg_get_functiondef('public.bite_customer_invoice(uuid)'::regprocedure) into def;
  def:=regexp_replace(def,'\mbegin\M',E'begin\n if exists(select 1 from public.orders o where o.id=p_order_id and o.customer_id is distinct from auth.uid() and not private.bite_restaurant_staff_can(o.restaurant_id,case when o.channel like ''POS - %'' then ''restaurant_pos'' else ''online_food_orders'' end)) then raise exception ''Owner has not allowed access to this bill'' using errcode=''42501'';end if;', 'i');
  execute def;
 end if;
end $reports$;

-- Owner initiated removal of operational/test records. Nothing is deleted by this migration.
create table private.bite_owner_deleted_data (
 request_id uuid primary key,property_id uuid not null references public.bite_properties(id),actor_id uuid not null references auth.users(id),
 scope text not null,source_ids uuid[] not null,preview_hash text not null,snapshot jsonb not null,created_at timestamptz not null default now()
);
revoke all on private.bite_owner_deleted_data from public,anon,authenticated;
alter table private.bite_owner_deleted_data enable row level security;

create function private.bite_owner_data_snapshot(p_property uuid,p_scope text,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tab text;predicate text;rows jsonb;result jsonb;stay_ids uuid[];folio_ids uuid[];begin
 if auth.uid() is null or private.bite_property_role(p_property) is distinct from 'owner' then raise exception 'Only the hotel owner can delete data' using errcode='42501';end if;
 if cardinality(p_ids)>500 then raise exception 'Select at most 500 records at a time';end if;
 tab:=case p_scope when 'stays' then 'bite_stays' when 'guests' then 'bite_guests' when 'rooms' then 'bite_rooms' when 'daybook' then 'bite_daily_book_entries' when 'expenses' then 'bite_property_expenses' when 'pos_drafts' then 'restaurant_pos_drafts' when 'restaurant_expenses' then 'restaurant_expenses' when 'menu_items' then 'menu_items' when 'tables' then 'restaurant_tables' end;
 if tab is null then raise exception 'Choose a supported data section';end if;
 predicate:=case when p_scope in('pos_drafts','restaurant_expenses','menu_items','tables') then 'restaurant_id in(select o.restaurant_id from public.bite_property_outlets o where o.property_id=$1 and public.has_restaurant_role(o.restaurant_id,array[''owner'']))' else 'property_id=$1' end;
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by r.id),''[]''::jsonb) from public.%I r where %s and (coalesce(cardinality($2),0)=0 or r.id=any($2))',tab,predicate) into rows using p_property,p_ids;
 result:=jsonb_build_object('table',tab,'rows',rows);
 if p_scope='stays' then
  select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into stay_ids from jsonb_array_elements(rows)x;
  select coalesce(array_agg(id),'{}'::uuid[]) into folio_ids from public.bite_folios where property_id=p_property and stay_id=any(stay_ids);
  result:=result||jsonb_build_object(
   'folios',(select coalesce(jsonb_agg(f order by f.id),'[]'::jsonb) from public.bite_folios f where property_id=p_property and id=any(folio_ids)),
   'entries',(select coalesce(jsonb_agg(e order by e.id),'[]'::jsonb) from public.bite_folio_entries e where property_id=p_property and folio_id=any(folio_ids)),
   'tasks',(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb) from public.bite_service_tasks t where property_id=p_property and stay_id=any(stay_ids)),
   'compliance',(select coalesce(jsonb_agg(c order by c.stay_id),'[]'::jsonb) from public.bite_stay_compliance c where property_id=p_property and stay_id=any(stay_ids)),
   'refunds',(select coalesce(jsonb_agg(r order by r.id),'[]'::jsonb) from public.bite_folio_refund_requests r where property_id=p_property and folio_id=any(folio_ids)),
   'links',(select coalesce(jsonb_agg(l order by l.folio_id),'[]'::jsonb) from public.bite_guest_folio_links l where property_id=p_property and folio_id=any(folio_ids)),
   'linked_food_bills',(select count(distinct e.source_order_id) from public.bite_folio_entries e where property_id=p_property and folio_id=any(folio_ids) and source_order_id is not null));
 elsif p_scope='guests' then
  result:=result||jsonb_build_object('documents',(select coalesce(jsonb_agg(d order by d.id),'[]'::jsonb) from public.bite_guest_documents d where property_id=p_property and (coalesce(cardinality(p_ids),0)=0 or guest_id=any(p_ids))));
 end if;
 return result;
end $$;

create function private.bite_owner_data_preview(p_property uuid,p_scope text,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;begin
 s:=private.bite_owner_data_snapshot(p_property,p_scope,p_ids);
 return jsonb_build_object('scope',p_scope,'count',jsonb_array_length(s->'rows'),'preview_hash',md5(s::text),'linked_food_bills',coalesce(s->'linked_food_bills','0'::jsonb),
 'records',(select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','label',coalesce(x->>'full_name',x->>'item_name',x->>'name',x->>'number',x->>'description',x->>'customer_name',x->>'room_id',x->>'id'),'date',coalesce(x->>'arrival',x->>'entry_date',x->>'expense_date',x->>'created_at'),'status',coalesce(x->>'status',''))),'[]'::jsonb)from jsonb_array_elements(s->'rows')x));
end $$;
create function public.bite_owner_data_preview(p_property uuid,p_scope text,p_ids uuid[] default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.bite_owner_data_preview(p_property,p_scope,p_ids)$$;

create function private.bite_owner_data_delete(p_property uuid,p_scope text,p_ids uuid[],p_preview_hash text,p_confirmation text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pr public.bite_properties;s jsonb;previous private.bite_owner_deleted_data;ids uuid[];fs uuid[];tab text;begin
 if auth.uid() is null or private.bite_property_role(p_property) is distinct from 'owner' then raise exception 'Only the hotel owner can delete data' using errcode='42501';end if;
 select * into strict pr from public.bite_properties where id=p_property for update;
 if p_request is null or p_confirmation is distinct from pr.name then raise exception 'Type the hotel name to confirm removal';end if;
 select * into previous from private.bite_owner_deleted_data where request_id=p_request;
 if found then
  if previous.property_id<>p_property or previous.actor_id<>auth.uid() or previous.scope<>p_scope or previous.source_ids is distinct from p_ids or previous.preview_hash<>p_preview_hash then raise exception 'Removal request was reused with different details';end if;
  return jsonb_build_object('deleted',jsonb_array_length(previous.snapshot->'rows'),'request_id',p_request,'already_complete',true);
 end if;
 s:=private.bite_owner_data_snapshot(p_property,p_scope,p_ids);
 if md5(s::text) is distinct from p_preview_hash then raise exception 'Records changed. Review the removal preview again';end if;
 if jsonb_array_length(s->'rows')=0 then raise exception 'No records selected';end if;
 select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(s->'rows')x;
 insert into private.bite_owner_deleted_data values(p_request,p_property,auth.uid(),p_scope,p_ids,p_preview_hash,s,now());
 perform set_config('bite.owner_data_reset',p_property::text,true);
 tab:=s->>'table';
 if p_scope='stays' then
  select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into fs from jsonb_array_elements(s->'folios')x;
  delete from public.bite_service_tasks where property_id=p_property and stay_id=any(ids);
  delete from public.bite_stay_compliance where property_id=p_property and stay_id=any(ids);
  delete from public.bite_folio_refund_requests where property_id=p_property and folio_id=any(fs);
  delete from public.bite_guest_folio_links where property_id=p_property and folio_id=any(fs);
  delete from public.bite_folio_entries where property_id=p_property and folio_id=any(fs);
  delete from public.bite_folios where property_id=p_property and id=any(fs);
  delete from public.bite_stays where property_id=p_property and id=any(ids);
  update public.bite_property_commands set action='deleted_by_owner',payload='{}',result='{"deleted_by_owner":true}' where property_id=p_property and (result->>'id'=any(ids::text[]) or result->>'folio_id'=any(fs::text[]) or result->>'id' in(select id::text from public.bite_booking_groups g where g.property_id=p_property and not exists(select 1 from public.bite_stays st where st.group_id=g.id)));
  delete from public.bite_booking_groups g where g.property_id=p_property and not exists(select 1 from public.bite_stays st where st.group_id=g.id);
  update public.bite_rooms r set housekeeping='ready' where property_id=p_property and housekeeping in('dirty','cleaning') and not exists(select 1 from public.bite_stays st where st.room_id=r.id and st.status='in_house');
 elsif p_scope='guests' then
  if exists(select 1 from public.bite_stays where property_id=p_property and guest_id=any(ids)) then raise exception 'Remove the selected guest stays first';end if;
  delete from public.bite_booking_groups g where g.property_id=p_property and g.payer_guest_id=any(ids) and not exists(select 1 from public.bite_stays st where st.group_id=g.id);
  -- Private file objects are never manipulated through SQL. Removing the metadata
  -- revokes all future ID-byte access; snapshots are retained only in private audit.
  delete from public.bite_guest_documents where property_id=p_property and guest_id=any(ids);
  delete from public.bite_guests where property_id=p_property and id=any(ids);
 else
  execute format('delete from public.%I where id=any($1)',tab) using ids;
 end if;
 if p_scope in('stays','daybook','expenses') then delete from public.bite_property_shift_closings where property_id=p_property;end if;
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id) values(p_property,auth.uid(),'owner_data_removed:'||p_scope,p_property,p_request);
 perform set_config('bite.owner_data_reset','',true);
 return jsonb_build_object('deleted',cardinality(ids),'request_id',p_request);
end $$;
create function public.bite_owner_data_delete(p_property uuid,p_scope text,p_ids uuid[],p_preview_hash text,p_confirmation text,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.bite_owner_data_delete(p_property,p_scope,p_ids,p_preview_hash,p_confirmation,p_request)$$;

-- The existing closed-day guard still protects ordinary edits. This narrow path
-- applies only while an authenticated property owner runs the reviewed reset RPC.
do $guard$
declare def text;begin
 select pg_get_functiondef('private.bite_guard_combined_hotel_day()'::regprocedure) into def;
 def:=replace(def,'begin',E'begin\n if coalesce(current_setting(''bite.owner_data_reset'',true),'''')=coalesce(to_jsonb(new)->>''property_id'',to_jsonb(old)->>''property_id'') and private.bite_property_role(coalesce(to_jsonb(new)->>''property_id'',to_jsonb(old)->>''property_id'')::uuid)=''owner'' then if TG_OP=''DELETE'' then return old;else return new;end if;end if;');
 execute def;
end $guard$;
revoke all on function private.bite_owner_data_snapshot(uuid,text,uuid[]),private.bite_owner_data_preview(uuid,text,uuid[]),private.bite_owner_data_delete(uuid,text,uuid[],text,text,uuid),public.bite_owner_data_preview(uuid,text,uuid[]),public.bite_owner_data_delete(uuid,text,uuid[],text,text,uuid) from public,anon,authenticated;
grant execute on function private.bite_owner_data_preview(uuid,text,uuid[]),private.bite_owner_data_delete(uuid,text,uuid[],text,text,uuid),public.bite_owner_data_preview(uuid,text,uuid[]),public.bite_owner_data_delete(uuid,text,uuid[],text,text,uuid) to authenticated;
