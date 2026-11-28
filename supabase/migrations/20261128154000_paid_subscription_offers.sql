-- Approved price and allowance snapshots for later server-side checkout.
-- Sale is disabled for every offer until paid rollout is separately enabled.
create table private.bite_subscription_offers (
 catalog_version integer not null check (catalog_version > 0),
 offer_code text not null,
 tier text check (tier in ('starter','plus','pro')),
 amount_paise integer not null check (amount_paise > 0),
 currency text not null default 'INR' check (currency = 'INR'),
 billing_months integer check (billing_months in (1,12)),
 pos_bill_limit integer check (pos_bill_limit > 0),
 room_limit integer check (room_limit > 0),
 extra_pos_bills integer check (extra_pos_bills > 0),
 hotel_checkout_unlimited boolean not null,
 sale_enabled boolean not null default false,
 primary key(catalog_version,offer_code),
 check (
  (tier is null and billing_months is null and pos_bill_limit is null
   and room_limit is null and extra_pos_bills is not null and not hotel_checkout_unlimited)
  or
  (tier is not null and billing_months is not null and room_limit is not null
   and extra_pos_bills is null and hotel_checkout_unlimited
   and ((tier='starter' and pos_bill_limit is not null)
     or (tier in ('plus','pro') and pos_bill_limit is null)))
 )
);
alter table private.bite_subscription_offers enable row level security;
revoke all on private.bite_subscription_offers from public,anon,authenticated,service_role;

insert into private.bite_subscription_offers
 (catalog_version,offer_code,tier,amount_paise,billing_months,pos_bill_limit,room_limit,extra_pos_bills,hotel_checkout_unlimited)
values
 (1,'starter_year','starter',149900,12,1000,15,null,true),
 (1,'plus_month','plus',39900,1,null,30,null,true),
 (1,'plus_year','plus',399900,12,null,30,null,true),
 (1,'pro_month','pro',69900,1,null,60,null,true),
 (1,'pro_year','pro',699900,12,null,60,null,true),
 (1,'pos_recharge_500',null,19900,null,null,null,500,false);

create function public.bite_subscription_offer(p_catalog_version integer,p_offer_code text)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(o) from private.bite_subscription_offers o
 where o.catalog_version=p_catalog_version and o.offer_code=p_offer_code;
$$;
revoke all on function public.bite_subscription_offer(integer,text) from public,anon,authenticated,service_role;
grant execute on function public.bite_subscription_offer(integer,text) to service_role;
