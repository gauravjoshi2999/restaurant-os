-- Candidate only: run in disposable QA, after menu channel columns.
-- Service role is the sole caller. Commit the first-attempt boundary before making a provider request.
CREATE OR REPLACE FUNCTION public.bite_claim_channel_payment_attempt(p_intent_id uuid,p_customer_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v public.bite_live_checkout_intents%rowtype; item record; item_ids uuid[]; matched integer:=0;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Service role only' USING errcode='42501'; END IF;
 SELECT * INTO v FROM public.bite_live_checkout_intents WHERE id=p_intent_id AND customer_id=p_customer_id FOR UPDATE;
 IF NOT FOUND OR v.status<>'awaiting_payment' THEN RETURN 'not_payable'; END IF;
 IF v.created_at IS NULL OR v.created_at<now()-interval '15 minutes' THEN RETURN 'not_payable'; END IF;
 -- Existing attempts may have reached the provider. Never clear or extend the original timestamp.
 IF v.provider_attempted_at IS NOT NULL OR v.provider_order_id IS NOT NULL THEN
  IF v.provider_attempted_at IS NULL OR v.provider_attempted_at>now()+interval '30 seconds' OR v.provider_attempted_at<now()-interval '90 seconds' THEN RETURN 'reconcile'; END IF;
  RETURN 'retry';
 END IF;
 IF v.priced_items IS NULL OR jsonb_typeof(v.priced_items)<>'array' THEN RETURN 'menu_changed'; END IF;
 IF jsonb_array_length(v.priced_items) NOT BETWEEN 1 AND 50 THEN RETURN 'menu_changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v.priced_items) x WHERE jsonb_typeof(x)<>'object' OR coalesce(x->>'menu_item_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN RETURN 'menu_changed'; END IF;
 SELECT array_agg(DISTINCT (x->>'menu_item_id')::uuid) INTO item_ids FROM jsonb_array_elements(v.priced_items) x;
 -- Lock each eligible item in stable order until attempt claim commits. Owner changes after this
 -- boundary affect new attempts, not a provider session which may already have been requested.
 FOR item IN SELECT id FROM public.menu_items WHERE restaurant_id=v.restaurant_id AND id=ANY(item_ids)
 AND is_available AND available_online ORDER BY id FOR SHARE LOOP matched:=matched+1; END LOOP;
 IF matched<>cardinality(item_ids) THEN RETURN 'menu_changed'; END IF;
 UPDATE public.bite_live_checkout_intents SET provider_attempted_at=now() WHERE id=v.id;
 RETURN 'claimed';
END $fn$;
REVOKE ALL ON FUNCTION public.bite_claim_channel_payment_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bite_claim_channel_payment_attempt(uuid,uuid) TO service_role;
