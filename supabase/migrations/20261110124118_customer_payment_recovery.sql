-- Payment attempts are immutable; browsing/cart drafts are independent of this ledger.
-- No existing payment is marked failed, cancelled, or paid by this migration.
alter table public.bite_live_checkout_intents
 add column provider_operation_token uuid,
 add column provider_operation_until timestamptz,
 add column provider_expires_at timestamptz,
 add column provider_payload jsonb,
 add column provider_checked_at timestamptz,
 add column provider_http_status integer,
 add column provider_error_code text,
 add column provider_order_status text,
 add column safely_closed_at timestamptz,
 add column closure_reason text,
 add column provider_close_evidence jsonb;

create index bite_checkout_unresolved_customer_idx on public.bite_live_checkout_intents(customer_id,created_at)
 where status in ('awaiting_payment','payment_verified') and safely_closed_at is null;

-- A fenced lease serializes create, verify and cancel across tabs/functions.
-- The customer lock also prevents a second payable intent while an older payment is unresolved.
create or replace function public.bite_claim_checkout_provider(p_intent_id uuid,p_customer_id uuid,p_token uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.bite_live_checkout_intents%rowtype; other_id uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 if p_action not in ('create','verify','cancel') or p_token is null or p_customer_id is null then raise exception 'Invalid operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('bite-payment:'||p_customer_id::text,0));
 select * into v from public.bite_live_checkout_intents where id=p_intent_id and customer_id=p_customer_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if v.status='activated' then return jsonb_build_object('intent',to_jsonb(v),'already_activated',true);end if;
 if v.provider_operation_until>now() then return jsonb_build_object('error','busy');end if;
 if p_action='create' then
  if v.status<>'awaiting_payment' or v.safely_closed_at is not null then return jsonb_build_object('error','closed');end if;
  select id into other_id from public.bite_live_checkout_intents i where i.customer_id=p_customer_id and i.id<>p_intent_id
   and i.status in ('awaiting_payment','payment_verified') and i.safely_closed_at is null
   and (i.provider_attempted_at is not null or i.provider_order_id is not null or i.provider_operation_until>now())
   order by i.created_at limit 1;
  if found then return jsonb_build_object('error','earlier_payment_unresolved','blocking_intent_id',other_id);end if;
 end if;
 update public.bite_live_checkout_intents set provider_operation_token=p_token,provider_operation_until=now()+interval '90 seconds',
  provider_expires_at=coalesce(provider_expires_at,case when provider_attempted_at is not null then created_at+interval '15 minutes' else now()+interval '30 minutes' end)
  where id=p_intent_id returning * into v;
 return jsonb_build_object('intent',to_jsonb(v));
end $$;
revoke all on function public.bite_claim_checkout_provider(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bite_claim_checkout_provider(uuid,uuid,uuid,text) to service_role;

-- Only trusted Edge code can record provider evidence. Leases fence stale workers.
create or replace function public.bite_record_checkout_provider(p_intent_id uuid,p_token uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.bite_live_checkout_intents%rowtype; ref text:='bite_live_'||replace(p_intent_id::text,'-','');
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found or v.provider_operation_token is distinct from p_token then raise exception 'Operation lease changed';end if;
 if p_evidence ? 'provider_order_id' and p_evidence->>'provider_order_id'<>ref then raise exception 'Invalid provider reference';end if;
 if p_evidence ? 'payload' and v.provider_payload is not null and v.provider_payload<>p_evidence->'payload' then raise exception 'Payment request is immutable';end if;
 if coalesce((p_evidence->>'safely_closed')::boolean,false) and (p_evidence->>'closure_reason' is null or p_evidence->>'closure_reason' not in ('never_requested','provider_not_found_after_expiry','provider_closed_without_pending_payments')) then raise exception 'Closure proof required';end if;
 update public.bite_live_checkout_intents set
  provider_payload=coalesce(provider_payload,p_evidence->'payload'),
  provider_attempted_at=case when coalesce((p_evidence->>'attempting')::boolean,false) then now() else provider_attempted_at end,
  provider_order_id=coalesce(p_evidence->>'provider_order_id',provider_order_id),
  provider_checked_at=case when p_evidence ? 'http_status' then now() else provider_checked_at end,
  provider_http_status=coalesce((p_evidence->>'http_status')::integer,provider_http_status),
  provider_error_code=case when p_evidence ? 'error_code' then left(p_evidence->>'error_code',80) else provider_error_code end,
  provider_order_status=coalesce(p_evidence->>'order_status',provider_order_status),
  status=case when coalesce((p_evidence->>'safely_closed')::boolean,false) and status not in ('activated','payment_verified') then 'expired' else status end,
  safely_closed_at=case when coalesce((p_evidence->>'safely_closed')::boolean,false) and status not in ('activated','payment_verified') then now() else safely_closed_at end,
  closure_reason=case when coalesce((p_evidence->>'safely_closed')::boolean,false) and status not in ('activated','payment_verified') then p_evidence->>'closure_reason' else closure_reason end,
  provider_close_evidence=case when coalesce((p_evidence->>'safely_closed')::boolean,false) and status not in ('activated','payment_verified') then p_evidence-'payload' else provider_close_evidence end,
  provider_operation_until=case when coalesce((p_evidence->>'release')::boolean,false) then null else provider_operation_until end,
  updated_at=now() where id=p_intent_id returning * into v;
 return jsonb_build_object('status',v.status,'order_id',v.activated_order_id,'safely_closed',v.safely_closed_at is not null);
end $$;
revoke all on function public.bite_record_checkout_provider(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bite_record_checkout_provider(uuid,uuid,jsonb) to service_role;

-- A late PAID result must still be honored, including after expiry/cancellation.
-- Row lock + the existing finalizer guarantee one real order per provider checkout.
create or replace function public.bite_activate_paid_checkout(p_intent_id uuid,p_provider_order_id text,p_amount numeric,p_currency text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.bite_live_checkout_intents%rowtype;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found or p_provider_order_id is distinct from 'bite_live_'||replace(p_intent_id::text,'-','') or p_amount is null
  or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>v.amount or p_currency is distinct from 'INR' or v.currency is distinct from 'INR' then raise exception 'Payment verification mismatch';end if;
 if v.status='activated' then return v.activated_order_id;end if;
 if v.provider_order_id is not null and v.provider_order_id<>p_provider_order_id then raise exception 'Provider reference mismatch';end if;
 update public.bite_live_checkout_intents set status='payment_verified',provider_order_id=p_provider_order_id,provider_order_status='PAID',provider_checked_at=now(),safely_closed_at=null,closure_reason=null,updated_at=now() where id=p_intent_id;
 return public.bite_finalize_verified_live_checkout(p_intent_id);
end $$;
revoke all on function public.bite_activate_paid_checkout(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.bite_activate_paid_checkout(uuid,text,numeric,text) to service_role;
