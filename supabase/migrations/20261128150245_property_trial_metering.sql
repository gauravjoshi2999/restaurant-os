-- Record trial usage for explicitly enrolled properties. Enforcement is a separate rollout.
create table private.bite_property_trials (
 property_id uuid primary key references public.bite_properties(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at > starts_at),
 pos_bill_limit integer not null default 300 check (pos_bill_limit > 0),
 room_limit integer not null default 15 check (room_limit > 0)
);

create table private.bite_trial_pos_bills (
 order_id uuid primary key,
 property_id uuid not null references private.bite_property_trials(property_id),
 issued_at timestamptz not null
);
create index bite_trial_pos_bills_property on private.bite_trial_pos_bills(property_id);
alter table private.bite_property_trials enable row level security;
alter table private.bite_trial_pos_bills enable row level security;
revoke all on private.bite_property_trials,private.bite_trial_pos_bills from public,anon,authenticated,service_role;

create function public.bite_enroll_property_trial(p_property uuid) returns void
language sql security definer set search_path='' as $$
 insert into private.bite_property_trials(property_id,starts_at,ends_at)
 values(p_property,statement_timestamp(),statement_timestamp()+interval '720 hours')
 on conflict (property_id) do nothing;
$$;
revoke all on function public.bite_enroll_property_trial(uuid) from public,anon,authenticated,service_role;
grant execute on function public.bite_enroll_property_trial(uuid) to service_role;

create function private.bite_meter_trial_pos_bill() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 trial_property uuid;
 issued_at timestamptz:=statement_timestamp();
begin
 if new.channel is null or new.channel not in ('POS - Counter','POS - Takeaway','POS - Dine-in')
    or coalesce(new.is_demo,false) then return new; end if;

 select trial.property_id into trial_property
 from public.bite_property_outlets outlet
 join private.bite_property_trials trial on trial.property_id=outlet.property_id
 where outlet.restaurant_id=new.restaurant_id
   and issued_at>=trial.starts_at and issued_at<trial.ends_at;
 if not found then return new; end if;

 -- Guest room food can use the POS writer. Use the authorized property scope
 -- as well as its generated order code. A plain counter bill counts as POS.
 if new.order_code like 'POS-ROOM-%'
    and current_setting('bite.staff_room_charge_scope',true)=trial_property::text then
  return new;
 end if;

 insert into private.bite_trial_pos_bills(order_id,property_id,issued_at)
 values(new.id,trial_property,issued_at)
 on conflict (order_id) do nothing;
 return new;
end;
$$;
revoke all on function private.bite_meter_trial_pos_bill() from public,anon,authenticated,service_role;
create trigger bite_meter_trial_pos_bill
 after insert on public.orders
 for each row execute function private.bite_meter_trial_pos_bill();

create function public.bite_property_trial_usage(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 trial private.bite_property_trials%rowtype;
 pos_bills integer;
 active_rooms integer;
begin
 if private.bite_property_role(p_property) is distinct from 'owner' then
  raise exception 'Only the property Owner can view subscription usage' using errcode='42501';
 end if;
 select * into trial from private.bite_property_trials where property_id=p_property;
 if not found then return jsonb_build_object('status','not_enrolled'); end if;

 select count(*) into pos_bills from private.bite_trial_pos_bills where property_id=p_property;
 select count(*) into active_rooms from public.bite_rooms where property_id=p_property and active;
 return jsonb_build_object(
  'status',case when statement_timestamp()>=trial.ends_at then 'expired' else 'trial' end,
  'starts_at',trial.starts_at,'ends_at',trial.ends_at,
  'pos_bills_used',pos_bills,'pos_bill_limit',trial.pos_bill_limit,
  'pos_bills_remaining',greatest(0,trial.pos_bill_limit-pos_bills),
  'active_rooms',active_rooms,'room_limit',trial.room_limit,
  'rooms_remaining',greatest(0,trial.room_limit-active_rooms)
 );
end;
$$;
revoke all on function public.bite_property_trial_usage(uuid) from public,anon,authenticated,service_role;
grant execute on function public.bite_property_trial_usage(uuid) to authenticated;
