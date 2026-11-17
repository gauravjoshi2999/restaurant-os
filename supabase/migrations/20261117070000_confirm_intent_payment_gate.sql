-- Harden confirmation request to persist its own server-side payment gate.
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
  -- The checkout is now permanently bound to restaurant approval. This
  -- write shares the transaction with the immutable approval snapshot.
  UPDATE public.bite_live_checkout_intents
    SET confirmation_required = true, updated_at = now()
    WHERE id = v_intent.id AND customer_id = v_intent.customer_id
      AND restaurant_id = v_intent.restaurant_id
      AND status = 'awaiting_payment'
      AND provider_order_id IS NULL AND provider_attempted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout changed before confirmation'; END IF;
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
