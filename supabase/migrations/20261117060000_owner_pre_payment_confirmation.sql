-- Pre-payment restaurant confirmation. Additive, opt-in until the checkout gate is deployed.
-- Release order: deploy migration + RPCs -> Edge gate -> customer/owner UI -> set confirmation_required DEFAULT true.
ALTER TABLE public.bite_live_checkout_intents
  ADD COLUMN IF NOT EXISTS confirmation_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.bite_order_confirmations (
  intent_id uuid PRIMARY KEY REFERENCES public.bite_live_checkout_intents(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  customer_id uuid NOT NULL REFERENCES auth.users(id),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','approved','rejected','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  customer_name text NOT NULL DEFAULT 'Customer',
  delivery_type text NOT NULL,
  destination text,
  customer_note text,
  priced_items jsonb NOT NULL,
  CONSTRAINT bite_confirmation_items_array CHECK (jsonb_typeof(priced_items) = 'array')
);
CREATE INDEX IF NOT EXISTS bite_order_confirmations_owner_queue_idx
  ON public.bite_order_confirmations(restaurant_id, state, expires_at);
CREATE INDEX IF NOT EXISTS bite_order_confirmations_customer_idx
  ON public.bite_order_confirmations(customer_id, created_at DESC);

ALTER TABLE public.bite_order_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bite_order_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bite_order_confirmations TO authenticated;
DROP POLICY IF EXISTS "customer or restaurant owner can read confirmations" ON public.bite_order_confirmations;
CREATE POLICY "customer or restaurant owner can read confirmations"
  ON public.bite_order_confirmations FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR public.has_restaurant_role(restaurant_id, ARRAY['owner','manager']::text[])
  );

-- Snapshot is created by a trusted RPC; no direct browser INSERT or UPDATE grant.
CREATE OR REPLACE FUNCTION public.bite_request_order_confirmation(p_intent_id uuid)
RETURNS public.bite_order_confirmations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_intent public.bite_live_checkout_intents%ROWTYPE;
  v_row public.bite_order_confirmations%ROWTYPE;
  v_name text;
  v_destination text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  SELECT * INTO v_intent FROM public.bite_live_checkout_intents
    WHERE id = p_intent_id AND customer_id = (SELECT auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout not found'; END IF;
  SELECT * INTO v_row FROM public.bite_order_confirmations WHERE intent_id = p_intent_id;
  IF FOUND THEN RETURN v_row; END IF;
  IF v_intent.status <> 'awaiting_payment' OR v_intent.provider_order_id IS NOT NULL
    OR v_intent.provider_attempted_at IS NOT NULL OR now() >= v_intent.created_at + interval '10 minutes'
  THEN RAISE EXCEPTION 'Checkout cannot be submitted for confirmation'; END IF;
  IF v_intent.priced_items IS NULL OR jsonb_typeof(v_intent.priced_items) <> 'array'
    OR jsonb_array_length(v_intent.priced_items) = 0
  THEN RAISE EXCEPTION 'Verified item details unavailable'; END IF;
  v_name := COALESCE(NULLIF(v_intent.customer_snapshot->>'full_name',''),
                     NULLIF(v_intent.customer_snapshot->>'name',''),'Customer');
  v_destination := NULLIF(concat_ws(', ', NULLIF(v_intent.address_snapshot->>'address_line',''),
    NULLIF(v_intent.address_snapshot->>'city',''),
    NULLIF(v_intent.address_snapshot->>'postal_code','')), '');
  INSERT INTO public.bite_order_confirmations(
    intent_id, restaurant_id, customer_id, expires_at, amount, customer_name,
    delivery_type, destination, customer_note, priced_items)
  VALUES (v_intent.id, v_intent.restaurant_id, v_intent.customer_id,
    LEAST(now() + interval '3 minutes', v_intent.created_at + interval '10 minutes'),
    v_intent.amount, v_name, COALESCE(v_intent.delivery_type,'pickup'),
    v_destination, v_intent.customer_note, v_intent.priced_items)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.bite_review_order_confirmation(
  p_intent_id uuid, p_decision text)
RETURNS public.bite_order_confirmations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.bite_order_confirmations%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_row FROM public.bite_order_confirmations
    WHERE intent_id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmation not found'; END IF;
  IF NOT public.has_restaurant_role(v_row.restaurant_id, ARRAY['owner','manager']::text[])
  THEN RAISE EXCEPTION 'Restaurant permission required'; END IF;
  IF v_row.state <> 'pending' THEN RETURN v_row; END IF;
  IF now() >= v_row.expires_at THEN
    UPDATE public.bite_order_confirmations SET state = 'expired'
      WHERE intent_id = p_intent_id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  UPDATE public.bite_order_confirmations
    SET state = p_decision, reviewed_at = now(), reviewed_by = (SELECT auth.uid())
    WHERE intent_id = p_intent_id AND state = 'pending'
    RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.bite_cancel_order_confirmation(p_intent_id uuid)
RETURNS public.bite_order_confirmations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_intent public.bite_live_checkout_intents%ROWTYPE;
        v_row public.bite_order_confirmations%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  SELECT * INTO v_intent FROM public.bite_live_checkout_intents
    WHERE id = p_intent_id AND customer_id = (SELECT auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout not found'; END IF;
  SELECT * INTO v_row FROM public.bite_order_confirmations
    WHERE intent_id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmation not found'; END IF;
  IF v_row.state IN ('cancelled','expired','rejected') THEN RETURN v_row; END IF;
  IF v_intent.provider_order_id IS NOT NULL OR v_intent.provider_attempted_at IS NOT NULL
    OR v_intent.status <> 'awaiting_payment'
  THEN RAISE EXCEPTION 'Payment may be in progress; verify or cancel with Cashfree'; END IF;
  UPDATE public.bite_live_checkout_intents
    SET status = 'expired', updated_at = now()
    WHERE id = p_intent_id AND status = 'awaiting_payment'
      AND provider_order_id IS NULL AND provider_attempted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout changed; refresh payment status'; END IF;
  UPDATE public.bite_order_confirmations
    SET state = 'cancelled'
    WHERE intent_id = p_intent_id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- SECURITY DEFINER functions in public must never be callable by PUBLIC or anon.
REVOKE ALL ON FUNCTION public.bite_request_order_confirmation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bite_review_order_confirmation(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bite_cancel_order_confirmation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bite_request_order_confirmation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bite_review_order_confirmation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bite_cancel_order_confirmation(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename='bite_order_confirmations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bite_order_confirmations;
  END IF;
END $$;
