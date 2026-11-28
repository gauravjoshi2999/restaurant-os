begin;
create temporary table sandbox_receipt_test(property_id uuid);
insert into sandbox_receipt_test
select property_id from public.bite_property_outlets where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
grant select on sandbox_receipt_test to service_role;

do $$begin
 if has_function_privilege('authenticated','public.bite_subscription_sandbox_receipt(uuid,uuid,uuid,text,integer,text)','EXECUTE')
    or has_function_privilege('anon','public.bite_subscription_sandbox_receipt(uuid,uuid,uuid,text,integer,text)','EXECUTE')
    or has_table_privilege('service_role','private.bite_subscription_sandbox_receipts','INSERT') then
  raise exception 'Sandbox receipt boundary is too broad';
 end if;
end $$;

set local role service_role;
do $$
declare
 property uuid:=(select property_id from sandbox_receipt_test);
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 plan_id uuid;
 recharge_id uuid;
 first_receipt jsonb;
 recharge_receipt jsonb;
begin
 plan_id:=(public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'starter_year')->>'attempt_id')::uuid;
 recharge_id:=(public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'pos_recharge_500')->>'attempt_id')::uuid;
 if public.bite_subscription_sandbox_receipt(property,owner_id,plan_id)->>'receipt' is not null then
  raise exception 'An unpaid attempt has a receipt';
 end if;
 begin
  perform public.bite_subscription_sandbox_receipt(property,owner_id,plan_id,'42',100,'INR');
  raise exception 'Incorrect payment amount recorded';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.bite_subscription_sandbox_receipt(property,'33333333-3333-4333-8333-333333333333',plan_id);
  raise exception 'Reception retrieved a subscription receipt';
 exception when insufficient_privilege then null;
 end;
 first_receipt:=public.bite_subscription_sandbox_receipt(property,owner_id,plan_id,'42',149900,'INR');
 if not (first_receipt @> '{"receipt":{"offer":{"offer_code":"starter_year","pos_bill_limit":1000,"room_limit":15}}}')
    or public.bite_subscription_sandbox_receipt(property,owner_id,plan_id,'42',149900,'INR') is distinct from first_receipt then
  raise exception 'Plan receipt snapshot or retry is incorrect';
 end if;
 begin
  perform public.bite_subscription_sandbox_receipt(property,owner_id,recharge_id,'42',19900,'INR');
  raise exception 'Same provider payment ID was used across attempts';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.bite_subscription_sandbox_receipt(property,owner_id,plan_id,'43',149900,'INR');
  raise exception 'A second payment was applied to the same plan attempt';
 exception when invalid_parameter_value then null;
 end;
 recharge_receipt:=public.bite_subscription_sandbox_receipt(property,owner_id,recharge_id,'44',19900,'INR');
 if not (recharge_receipt @> '{"receipt":{"offer":{"offer_code":"pos_recharge_500","extra_pos_bills":500}}}') then
  raise exception 'Recharge did not preserve its 500-bill sandbox grant';
 end if;
end $$;
reset role;
do $$begin
 if (select count(*) from private.bite_subscription_sandbox_receipts)<>2
    or exists(select from private.bite_subscription_offers where sale_enabled) then
  raise exception 'Sandbox receipt changed paid activation or duplicated a grant';
 end if;
 raise notice 'PASS: sandbox plan and recharge grants are recorded once from matching evidence';
end $$;
rollback;
