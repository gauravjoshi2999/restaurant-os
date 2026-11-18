-- Room-food permission scopes internal POS writes to the authorized room command.

create or replace function private.bite_property_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;previous_scope text:=coalesce(current_setting('bite.staff_room_charge_scope',true),'');begin
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);
 if p_action in('room_pos','room_post') and private.bite_staff_can(p_property,'room_charge') then perform set_config('bite.staff_room_charge_scope',p_property::text,true);end if;
 begin result:=private.bite_property_command_before_staff_permissions(p_property,p_action,p_payload,p_request);
 exception when others then perform set_config('bite.staff_room_charge_scope',previous_scope,true);raise;end;
 perform set_config('bite.staff_room_charge_scope',previous_scope,true);return result;
end $$;

create or replace function private.bite_hotel_account_command(p_property uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;previous_scope text:=coalesce(current_setting('bite.staff_room_charge_scope',true),'');begin
 perform private.bite_assert_staff_action(p_property,p_action,p_payload);
 if p_action in('room_pos','room_post') and private.bite_staff_can(p_property,'room_charge') then perform set_config('bite.staff_room_charge_scope',p_property::text,true);end if;
 begin result:=private.bite_hotel_account_command_before_staff_permissions(p_property,p_action,p_payload,p_request);
 exception when others then perform set_config('bite.staff_room_charge_scope',previous_scope,true);raise;end;
 perform set_config('bite.staff_room_charge_scope',previous_scope,true);return result;
end $$;

create or replace function private.bite_guard_restaurant_staff() returns trigger language plpgsql security definer set search_path='' as $$
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
  if not private.bite_restaurant_staff_can(rid,permission) and not(permission='pos_entry' and coalesce(current_setting('bite.staff_room_charge_scope',true),'')=pid::text and private.bite_staff_can(pid,'room_charge')) then raise exception 'Owner has not allowed this operation' using errcode='42501';end if;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
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
