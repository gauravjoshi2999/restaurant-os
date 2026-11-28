begin;
do $$
declare
 property uuid:=(select property_id from public.bite_property_outlets where restaurant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 starter uuid;
 plus uuid;
 recharge uuid;
 bill uuid:=gen_random_uuid();
 metric jsonb;
 first_allocation text;
 replay_allocation text;
 extra_allocation text;
begin
 if has_function_privilege('authenticated','public.bite_sandbox_subscription_status(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.bite_meter_sandbox_subscription_bill(uuid,uuid)','EXECUTE') then
  raise exception 'Client can access the service-only sandbox commands';
 end if;
 if public.bite_meter_sandbox_subscription_bill(property,bill)<>'plan_inactive' then
  raise exception 'An unpaid property could consume a paid allowance';
 end if;

 starter:=(public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'starter_year')->>'attempt_id')::uuid;
 plus:=(public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'plus_month')->>'attempt_id')::uuid;
 recharge:=(public.bite_prepare_subscription_sandbox(property,owner_id,gen_random_uuid(),1,'pos_recharge_500')->>'attempt_id')::uuid;
 perform public.bite_subscription_sandbox_receipt(property,owner_id,starter,'9201',149900,'INR');
 perform public.bite_subscription_sandbox_receipt(property,owner_id,starter,'9201',149900,'INR');
 perform public.bite_subscription_sandbox_receipt(property,owner_id,plus,'9202',39900,'INR');
 perform public.bite_subscription_sandbox_receipt(property,owner_id,recharge,'9203',19900,'INR');

 metric:=public.bite_sandbox_subscription_status(property,owner_id);
 if not (metric @> '{"status":"active","tier":"starter","next_tier":"plus","pos_bills_remaining":1000,"room_limit":15,"recharge_bills_available":500}')
    or metric->>'ends_at' is distinct from metric->>'next_starts_at'
    or (select count(*) from private.bite_sandbox_subscription_terms where property_id=property)<>2 then
  raise exception 'Paid or renewed term boundary is incorrect';
 end if;

 -- Keep the synthetic quota small to exercise the last included bill and recharge.
 update private.bite_sandbox_subscription_terms set pos_bill_limit=1 where receipt_id=starter;
 first_allocation:=public.bite_meter_sandbox_subscription_bill(property,bill);
 replay_allocation:=public.bite_meter_sandbox_subscription_bill(property,bill);
 extra_allocation:=public.bite_meter_sandbox_subscription_bill(property,gen_random_uuid());
 metric:=public.bite_sandbox_subscription_status(property,owner_id);
 if first_allocation<>'plan' or replay_allocation<>'plan' or extra_allocation<>'recharge'
    or not (metric @> '{"pos_bills_remaining":0,"recharge_bills_available":499}') then
  raise exception 'Included quota, recharge priority or reprint count is incorrect';
 end if;

 update private.bite_sandbox_subscription_terms set starts_at=statement_timestamp()-interval '2 years',
  ends_at=statement_timestamp()-interval '1 minute' where receipt_id=starter;
 update private.bite_sandbox_subscription_terms set starts_at=statement_timestamp()-interval '1 minute'
 where receipt_id=plus;
 if public.bite_meter_sandbox_subscription_bill(property,gen_random_uuid())<>'unlimited'
    or not (public.bite_sandbox_subscription_status(property,owner_id) @> '{"tier":"plus","room_limit":30,"pos_bill_limit":null,"recharge_bills_saved":499,"recharge_bills_available":0}') then
  raise exception 'Unlimited plan consumed prepaid credits';
 end if;
 update private.bite_sandbox_subscription_terms set starts_at=statement_timestamp()-interval '2 minutes',
  ends_at=statement_timestamp()-interval '1 minute' where receipt_id=plus;
 if public.bite_meter_sandbox_subscription_bill(property,gen_random_uuid())<>'plan_inactive'
    or public.bite_meter_sandbox_subscription_bill(property,bill)<>'plan'
    or not (public.bite_sandbox_subscription_status(property,owner_id) @> '{"status":"expired","recharge_bills_saved":499,"recharge_bills_available":0}') then
  raise exception 'Expiry consumed credits, accepted new usage or blocked a reprint';
 end if;
 raise notice 'PASS: paid terms, queued renewal, POS quota, recharge, unlimited usage, replay and expiry';
end $$;
rollback;
