-- Verification records sandbox entitlements without touching live subscriptions or usage.
create table private.bite_subscription_sandbox_receipts (
 attempt_id uuid primary key references private.bite_subscription_sandbox_attempts(id),
 provider_payment_id text not null unique check (provider_payment_id ~ '^[0-9]{1,32}$'),
 grant_snapshot jsonb not null,
 verified_at timestamptz not null default statement_timestamp()
);
alter table private.bite_subscription_sandbox_receipts enable row level security;
revoke all on private.bite_subscription_sandbox_receipts from public,anon,authenticated,service_role;

create function public.bite_subscription_sandbox_receipt(
 p_property uuid,p_actor uuid,p_attempt uuid,
 p_payment_id text default null,p_amount_paise integer default null,p_currency text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 attempt private.bite_subscription_sandbox_attempts%rowtype;
 receipt private.bite_subscription_sandbox_receipts%rowtype;
begin
 select a.* into attempt
 from private.bite_subscription_sandbox_attempts a
 join public.bite_property_members m on m.property_id=a.property_id and m.user_id=a.owner_id
 where a.id=p_attempt and a.property_id=p_property and a.owner_id=p_actor
  and m.role='owner' and m.active
  and not exists(select from public.platform_admins where user_id=p_actor)
 for share of m;
 if not found then raise exception 'Active property Owner required' using errcode='42501'; end if;

 if p_payment_id is not null then
  if p_payment_id !~ '^[0-9]{1,32}$' or p_amount_paise is distinct from attempt.amount_paise
     or p_currency is distinct from attempt.currency then
   raise exception 'Payment evidence does not match the attempt' using errcode='22023';
  end if;
  insert into private.bite_subscription_sandbox_receipts(attempt_id,provider_payment_id,grant_snapshot)
  values(attempt.id,p_payment_id,attempt.offer_snapshot)
  on conflict do nothing;
 end if;

 select * into receipt from private.bite_subscription_sandbox_receipts where attempt_id=attempt.id;
 if p_payment_id is not null and receipt.provider_payment_id is distinct from p_payment_id then
  raise exception 'Payment was previously matched to a different receipt' using errcode='22023';
 end if;

 return jsonb_build_object('attempt_id',attempt.id,'amount_paise',attempt.amount_paise,
  'currency',attempt.currency,
  'receipt',case when receipt.attempt_id is null then null else jsonb_build_object(
   'verified_at',receipt.verified_at,'offer',receipt.grant_snapshot) end);
end;
$$;
revoke all on function public.bite_subscription_sandbox_receipt(uuid,uuid,uuid,text,integer,text)
 from public,anon,authenticated,service_role;
grant execute on function public.bite_subscription_sandbox_receipt(uuid,uuid,uuid,text,integer,text)
 to service_role;
