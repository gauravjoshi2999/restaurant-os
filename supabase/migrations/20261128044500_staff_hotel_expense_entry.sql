-- Staff can record a hotel expense without seeing property expenses or reports.
create function private.bite_record_staff_property_expense(p_property uuid,p_payload jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_property public.bite_properties;
 v_prior public.bite_property_commands;
 v_amount numeric;
 v_date date;
 v_id uuid;
 v_result jsonb;
begin
 if v_actor is null or p_request is null or coalesce(jsonb_typeof(p_payload),'')<>'object' then
  raise exception 'Authenticated expense request required' using errcode='42501';
 end if;
 -- Serialize with access changes and the existing property ledger.
 select * into v_property from public.bite_properties where id=p_property for update;
 if not found or v_property.business_type not in ('hotel','hybrid') or not 'expenses'=any(v_property.capabilities)
 or not private.bite_staff_can(p_property,'expense_entry') then
  raise exception 'Property expense entry is unavailable for this account' using errcode='42501';
 end if;
 select * into v_prior from public.bite_property_commands
 where property_id=p_property and request_id=p_request;
 if found then
  if v_prior.created_by is distinct from v_actor or v_prior.action<>'expense' or v_prior.payload<>p_payload then
   raise exception 'Request ID already used for different details';
  end if;
  return jsonb_build_object('id',v_prior.result->>'id','confirmed',true);
 end if;
 v_amount:=(p_payload->>'amount')::numeric;
 v_date:=(p_payload->>'expense_date')::date;
 if v_amount is null or v_amount not between 0.01 and 999999999999.99 or v_amount<>round(v_amount,2) then
  raise exception 'Enter a positive amount with up to two decimal places';
 end if;
 if v_date is null or v_date>(now() at time zone v_property.timezone)::date then
  raise exception 'Enter a valid expense date';
 end if;
 insert into public.bite_property_expenses(property_id,description,amount,expense_date,method,created_by)
 values(p_property,trim(p_payload->>'description'),v_amount,v_date,p_payload->>'method',v_actor)
 returning id into v_id;
 v_result:=jsonb_build_object('id',v_id,'confirmed',true);
 insert into public.bite_property_commands(property_id,request_id,action,payload,result,created_by)
 values(p_property,p_request,'expense',p_payload,v_result,v_actor);
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
 values(p_property,v_actor,'expense',v_id,p_request);
 return v_result;
end $$;
revoke all on function private.bite_record_staff_property_expense(uuid,jsonb,uuid)
 from public,anon,authenticated;

-- Preserve the property command boundary for existing writes and retries.

create or replace function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;previous_scope text:=coalesce(current_setting('bite.staff_room_charge_scope',true),'');begin
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);
 if p_action='expense' and exists (
  select 1 from public.bite_properties where id=p_property and business_type in ('hotel','hybrid')
 ) and (private.bite_property_role(p_property) not in ('owner','manager') or not private.bite_can(p_property,'expenses')) then
  return private.bite_record_staff_property_expense(p_property,p_payload,p_request);
 end if;
 if p_action in('room_pos','room_post') and private.bite_staff_can(p_property,'room_charge') then perform set_config('bite.staff_room_charge_scope',p_property::text,true);end if;
 begin result:=private.bite_property_command_before_staff_permissions(p_property,p_action,p_payload,p_request);
 exception when others then perform set_config('bite.staff_room_charge_scope',previous_scope,true);raise;end;
 perform set_config('bite.staff_room_charge_scope',previous_scope,true);return result;
end $$;

create or replace function private.bite_save_staff_access(p_property uuid,p_user uuid,p_email text,p_role text,p_active boolean,p_permissions text[]) returns jsonb
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
 if 'pos_entry'=any(perms) then perms:=perms||array['payment_entry'];end if; -- Pay-now POS bills record the received payment.
 if 'room_charge'=any(perms) then perms:=perms||array['charge_to_room','hotel_incidentals'];end if;
 if 'orders_manage'=any(perms) then perms:=perms||array['online_food_orders'];end if;
 if 'menu_manage'=any(perms) then perms:=perms||array['restaurant_menu'];end if;
 -- Restaurant expense forms still depend on outlet history. Hotel expense input is independent.
 if 'expense_entry'=any(perms) and exists (
  select 1 from public.bite_properties where id=p_property and business_type='restaurant'
 ) then perms:=perms||array['expenses'];end if;
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
