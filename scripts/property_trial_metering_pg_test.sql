-- Runs against the disposable Owner schema. All trial data rolls back.
begin;
create temporary table trial_test_properties as
select property_id,restaurant_id from public.bite_property_outlets
where restaurant_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
grant select on trial_test_properties to authenticated,service_role;

-- The shared suite changes outlet modules in its other cases. Set a known
-- hybrid property state so the real module guard allows marketplace and POS.
update public.bite_properties
set business_type='hybrid',capabilities=private.bite_default_capabilities('hybrid')
where id in (select property_id from trial_test_properties);

insert into public.orders(restaurant_id,order_code,channel,amount)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TRIAL-PREVIOUS','POS - Counter',100);
set local role service_role;
select public.bite_enroll_property_trial(property_id) from trial_test_properties
where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
reset role;
create temporary table trial_initial as select * from private.bite_property_trials;
set local role service_role;
select public.bite_enroll_property_trial(property_id) from trial_test_properties
where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
reset role;

do $$
declare
 property uuid:=(select property_id from trial_initial);
 outlet uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 first_bill uuid;
begin
 if exists(select * from private.bite_property_trials except select * from trial_initial)
    or not exists(select from trial_initial where ends_at-starts_at=interval '720 hours') then
  raise exception 'Trial retry changed the enrollment or duration';
 end if;
 insert into public.bite_rooms(property_id,number,room_type,nightly_rate,active)
 select property,'TRIAL-'||n,'Synthetic',100,n<=15 from generate_series(1,16) n;
 insert into public.orders(restaurant_id,order_code,channel,amount,is_demo) values
  (outlet,'TRIAL-ONLINE','Own Platform',100,false),
  (outlet,'TRIAL-DEMO','POS - Counter',100,true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','TRIAL-UNENROLLED','POS - Counter',100,false);
 perform set_config('bite.staff_room_charge_scope',property::text,true);
 insert into public.orders(restaurant_id,order_code,channel,amount)
 values(outlet,'POS-ROOM-TRIAL','POS - Counter',100);
 perform set_config('bite.staff_room_charge_scope','',true);

 -- Only the trusted room scope plus the room order code qualifies for exclusion.
 insert into public.orders(restaurant_id,order_code,channel,amount)
 values(outlet,'POS-ROOM-COUNTER-TEST','POS - Counter',100) returning id into first_bill;
 insert into public.orders(restaurant_id,order_code,channel,amount)
 select outlet,'TRIAL-POS-'||n,case when n%2=0 then 'POS - Takeaway' else 'POS - Dine-in' end,100
 from generate_series(1,299) n;
 update public.orders set status='Cancelled' where id=first_bill;
 insert into public.orders(restaurant_id,order_code,channel,amount)
 values(outlet,'POS-ROOM-COUNTER-TEST','POS - Counter',100) on conflict(restaurant_id,order_code) do nothing;
 begin
  insert into public.orders(restaurant_id,order_code,channel,amount)
  values(outlet,'TRIAL-ROLLED-BACK','POS - Counter',100);
  raise sqlstate 'B9001';
 exception when sqlstate 'B9001' then null;
 end;
end $$;

insert into public.bite_property_members(property_id,user_id,role)
select property_id,'33333333-3333-4333-8333-333333333333','receptionist' from trial_initial;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$
declare
 property uuid:=(select property_id from trial_test_properties where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 other_property uuid:=(select property_id from trial_test_properties where restaurant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 usage jsonb;
begin
 usage:=public.bite_property_trial_usage(property);
 if not (usage @> '{"status":"trial","pos_bills_used":300,"pos_bill_limit":300,"pos_bills_remaining":0,"active_rooms":15,"room_limit":15,"rooms_remaining":0}') then
  raise exception 'Incorrect trial summary: %',usage;
 end if;
 begin
  perform public.bite_property_trial_usage(other_property);
  raise exception 'Owner could read another property';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.bite_enroll_property_trial(other_property);
  raise exception 'Owner could provision a trial';
 exception when insufficient_privilege then null;
 end;
 begin
  perform 1 from private.bite_trial_pos_bills;
  raise exception 'Owner could directly read metering rows';
 exception when insufficient_privilege then null;
 end;
end $$;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$begin
 begin
  perform public.bite_property_trial_usage(property_id) from trial_test_properties
  where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Reception could read Owner-only usage';
 exception when insufficient_privilege then null;
 end;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$begin
 if exists(select from trial_test_properties
  where restaurant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
   and public.bite_property_trial_usage(property_id) is distinct from '{"status":"not_enrolled"}'::jsonb) then
  raise exception 'An existing property was enrolled automatically';
 end if;
end $$;
reset role;

insert into public.orders(restaurant_id,order_code,channel,amount)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TRIAL-ABOVE-ALLOWANCE','POS - Counter',100);
update public.bite_rooms set active=true where number='TRIAL-16';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$begin
 if exists(select from trial_test_properties
  where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and not (public.bite_property_trial_usage(property_id) @> '{"pos_bills_used":301,"pos_bills_remaining":0,"active_rooms":16,"rooms_remaining":0}')) then
  raise exception 'Shadow metering did not report the over-limit usage';
 end if;
end $$;
reset role;

-- Past the 30-day window, new sales still operate and do not add to trial usage.
update private.bite_property_trials set starts_at=statement_timestamp()-interval '721 hours',
 ends_at=statement_timestamp()-interval '1 hour';
insert into public.orders(restaurant_id,order_code,channel,amount)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TRIAL-EXPIRED','POS - Counter',100);
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$begin
 if exists(select from trial_test_properties
  where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and not (public.bite_property_trial_usage(property_id) @> '{"status":"expired","pos_bills_used":301}')) then
  raise exception 'Expired trial counted a new bill or returned the wrong state';
 end if;
 raise notice 'PASS: 30-day trial, 300 issued POS bills, 15 active rooms, exclusions, duplicate write, rollback, expiry and Owner boundaries';
end $$;
rollback;
