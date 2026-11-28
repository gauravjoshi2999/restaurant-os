begin;
create temporary table sandbox_checkout_properties as
select * from public.bite_property_outlets
where restaurant_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
grant select on sandbox_checkout_properties to service_role;

do $$begin
 if has_function_privilege('authenticated','public.bite_prepare_subscription_sandbox(uuid,uuid,uuid,integer,text)','EXECUTE')
    or has_function_privilege('anon','public.bite_prepare_subscription_sandbox(uuid,uuid,uuid,integer,text)','EXECUTE')
    or has_table_privilege('service_role','private.bite_subscription_sandbox_attempts','INSERT') then
  raise exception 'Sandbox checkout boundary is too broad';
 end if;
end $$;

create temporary table sandbox_checkout_evidence (attempt jsonb);
grant select,insert on sandbox_checkout_evidence to service_role;
set local role service_role;
do $$
declare
 property uuid:=(select property_id from sandbox_checkout_properties where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 other_property uuid:=(select property_id from sandbox_checkout_properties where restaurant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 request_id uuid:='f09e0000-0000-4000-8000-000000000001';
 first_attempt jsonb;
 recharge jsonb;
begin
 first_attempt:=public.bite_prepare_subscription_sandbox(property,owner_id,request_id,1,'starter_year');
 if not (first_attempt @> '{"amount_paise":149900,"currency":"INR"}')
    or first_attempt->>'attempt_id' is null or first_attempt->>'expires_at' is null then
  raise exception 'Starter amount snapshot is incorrect';
 end if;
 insert into sandbox_checkout_evidence values(first_attempt);
 if public.bite_prepare_subscription_sandbox(property,owner_id,request_id,1,'starter_year') is distinct from first_attempt then
  raise exception 'Retry created a second sandbox payment attempt';
 end if;
 begin
  perform public.bite_prepare_subscription_sandbox(property,owner_id,request_id,1,'pro_year');
  raise exception 'Retry swapped the approved offer';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),2,'starter_year');
  raise exception 'Unknown catalog version accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.bite_prepare_subscription_sandbox(other_property,owner_id,gen_random_uuid(),1,'starter_year');
  raise exception 'A different property accepted the Owner session';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.bite_prepare_subscription_sandbox(property,'33333333-3333-4333-8333-333333333333',request_id,1,'starter_year');
  raise exception 'Reception retrieved a sandbox payment attempt';
 exception when insufficient_privilege then null;
 end;
 recharge:=public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'pos_recharge_500');
 if not (recharge @> '{"amount_paise":19900,"currency":"INR"}')
    or recharge->>'attempt_id'=first_attempt->>'attempt_id' then
  raise exception 'Recharge is missing an independent attempt';
 end if;
end $$;
reset role;

update private.bite_subscription_offers set amount_paise=150000 where catalog_version=1 and offer_code='starter_year';
set local role service_role;
do $$
declare
 property uuid:=(select property_id from sandbox_checkout_properties where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
begin
 if public.bite_prepare_subscription_sandbox(property,'11111111-1111-4111-8111-111111111111',
  'f09e0000-0000-4000-8000-000000000001',1,'starter_year')
  is distinct from (select attempt from sandbox_checkout_evidence) then
  raise exception 'A catalog change altered an existing payment attempt';
 end if;
end $$;
reset role;
do $$begin
 if (select count(*) from private.bite_subscription_sandbox_attempts)<>2
    or exists(select from private.bite_subscription_offers where sale_enabled) then
  raise exception 'Sandbox attempt changed paid offer availability or duplicated a retry';
 end if;
 raise notice 'PASS: sandbox attempt property ownership, frozen price, idempotent retry and no paid activation';
end $$;
rollback;
