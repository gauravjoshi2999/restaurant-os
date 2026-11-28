-- Sandbox purchase attempts. No production order, entitlement or charge is created here.
create table private.bite_subscription_sandbox_attempts (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.bite_properties(id),
 owner_id uuid not null references auth.users(id),
 request_id uuid not null,
 catalog_version integer not null,
 offer_code text not null,
 amount_paise integer not null check (amount_paise > 0),
 currency text not null check (currency='INR'),
 created_at timestamptz not null,
 expires_at timestamptz not null check (expires_at > created_at),
 unique(property_id,request_id),
 foreign key(catalog_version,offer_code)
  references private.bite_subscription_offers(catalog_version,offer_code)
);
alter table private.bite_subscription_sandbox_attempts enable row level security;
revoke all on private.bite_subscription_sandbox_attempts from public,anon,authenticated,service_role;

-- The sandbox still requires an active property owner. The Edge Function
-- supplies the actor from a verified session, never from the request body.
create function public.bite_prepare_subscription_sandbox(
 p_property uuid,p_actor uuid,p_request uuid,p_catalog_version integer,p_offer_code text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 attempt private.bite_subscription_sandbox_attempts%rowtype;
 offer private.bite_subscription_offers%rowtype;
 request_time timestamptz:=date_trunc('second',statement_timestamp());
begin
 if not exists (
  select from public.bite_property_members
  where property_id=p_property and user_id=p_actor and role='owner' and active
 ) or exists (select from public.platform_admins where user_id=p_actor) then
  raise exception 'Active property owner required' using errcode='42501';
 end if;
 if p_request is null then
  raise exception 'A request ID is required' using errcode='22023';
 end if;

 select * into attempt from private.bite_subscription_sandbox_attempts
 where property_id=p_property and request_id=p_request;
 if not found then
  select * into offer from private.bite_subscription_offers
  where catalog_version=p_catalog_version and offer_code=p_offer_code;
  if not found then raise exception 'Unknown subscription offer' using errcode='22023'; end if;

  insert into private.bite_subscription_sandbox_attempts
   (property_id,owner_id,request_id,catalog_version,offer_code,amount_paise,currency,created_at,expires_at)
  values(p_property,p_actor,p_request,offer.catalog_version,offer.offer_code,offer.amount_paise,
   offer.currency,request_time,request_time+interval '20 minutes')
  on conflict (property_id,request_id) do nothing returning * into attempt;
  if not found then
   select * into strict attempt from private.bite_subscription_sandbox_attempts
   where property_id=p_property and request_id=p_request;
  end if;
 end if;

 if attempt.owner_id is distinct from p_actor or attempt.catalog_version is distinct from p_catalog_version
    or attempt.offer_code is distinct from p_offer_code then
  raise exception 'Request ID already used for a different attempt' using errcode='22023';
 end if;
 return jsonb_build_object('attempt_id',attempt.id,'amount_paise',attempt.amount_paise,
  'currency',attempt.currency,'expires_at',attempt.expires_at);
end;
$$;
revoke all on function public.bite_prepare_subscription_sandbox(uuid,uuid,uuid,integer,text)
 from public,anon,authenticated,service_role;
grant execute on function public.bite_prepare_subscription_sandbox(uuid,uuid,uuid,integer,text)
 to service_role;
