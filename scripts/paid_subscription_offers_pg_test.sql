begin;
do $$begin
 if (select count(*) from private.bite_subscription_offers)<>6 then
  raise exception 'Expected only the six approved paid offers';
 end if;
 if not exists (select from private.bite_subscription_offers where tier is null and extra_pos_bills=500)
    or exists (select from private.bite_subscription_offers where tier is not null and extra_pos_bills is not null) then
  raise exception 'Recharge must add bills without changing the subscription tier';
 end if;
 if has_function_privilege('anon','public.bite_subscription_offer(integer,text)','EXECUTE')
    or has_function_privilege('authenticated','public.bite_subscription_offer(integer,text)','EXECUTE')
    or has_table_privilege('service_role','private.bite_subscription_offers','UPDATE') then
  raise exception 'Offer lookup or write access is too broad';
 end if;
end $$;

set local role service_role;
do $$
declare
 expected record;
 offer jsonb;
begin
 for expected in select * from (values
  ('starter_year',149900,12,1000,15,null,true),
  ('plus_month',39900,1,null,30,null,true),
  ('plus_year',399900,12,null,30,null,true),
  ('pro_month',69900,1,null,60,null,true),
  ('pro_year',699900,12,null,60,null,true),
  ('pos_recharge_500',19900,null,null,null,500,false)
 ) e(code,paise,months,pos_limit,rooms,extra_bills,hotel_checkout)
 loop
  offer:=public.bite_subscription_offer(1,expected.code);
  if offer is null or not (offer @> jsonb_build_object(
   'offer_code',expected.code,'catalog_version',1,'currency','INR','sale_enabled',false,
   'amount_paise',expected.paise,'billing_months',expected.months,'pos_bill_limit',expected.pos_limit,
   'room_limit',expected.rooms,'extra_pos_bills',expected.extra_bills,'hotel_checkout_unlimited',expected.hotel_checkout
  )) then
   raise exception 'Paid offer differs from approved amounts or allowances: %',expected.code;
  end if;
 end loop;
 if public.bite_subscription_offer(2,'starter_year') is not null
    or public.bite_subscription_offer(1,'custom_quote') is not null then
  raise exception 'Unknown version or custom quote must have no checkout price';
 end if;
 raise notice 'PASS: approved versioned pricing, room limits, POS caps, recharge and disabled sale';
end $$;
rollback;
