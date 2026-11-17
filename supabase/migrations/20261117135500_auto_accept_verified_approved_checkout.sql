-- Keep paid-order fulfillment consistent with a previous restaurant approval.
-- Idempotent and non-retroactive: only the verified checkout finalizer's NEW order changes.
-- The recorded 'Accepted' status means payment verified for the already approved request;
-- the owner can start cooking without accepting twice.
DO $bite_approved_payment$
DECLARE
  ddl text;
  target text := ' update public.bite_live_checkout_intents set status=''activated'',activated_order_id=v_order,updated_at=now() where id=p_intent_id;';
  patch text := $patch$
 -- BITE_PREPAY_APPROVAL_AUTO_ACCEPT_V1
 -- Only the server-verified, already restaurant-approved checkout skips a second Accept.
 update public.orders o
    set status='Accepted',
        status_note='Restaurant confirmed before payment; payment verified'
  where o.id=v_order and o.restaurant_id=v.restaurant_id and o.customer_id=v.customer_id
    and o.channel='Own Platform' and o.is_demo is not true and o.status='Received'
    and exists(
      select 1 from public.bite_order_confirmations c
       where c.intent_id=v.id and c.restaurant_id=v.restaurant_id
         and c.customer_id=v.customer_id and c.state='approved'
         and c.reviewed_by is not null and c.reviewed_at is not null
         and c.reviewed_at<=now()
    );
$patch$;
BEGIN
 SELECT pg_get_functiondef('public.bite_finalize_verified_live_checkout(uuid)'::regprocedure) INTO ddl;
 IF ddl IS NULL THEN RAISE EXCEPTION 'Verified checkout finalizer absent'; END IF;
 IF position('BITE_PREPAY_APPROVAL_AUTO_ACCEPT_V1' in ddl) > 0 THEN RETURN; END IF;
 IF position(target in ddl)=0 THEN RAISE EXCEPTION 'Finalizer changed; do not patch without review'; END IF;
 ddl:=replace(ddl,target,patch||target);
 EXECUTE ddl;
END $bite_approved_payment$;
