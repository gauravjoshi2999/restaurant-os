-- New, unpaid customer requests may notify the assigned restaurant owner.
-- This is a separate queue from verified paid-order notifications and refunds.
-- No browser write grants, no private customer data in FCM payloads.
CREATE TABLE IF NOT EXISTS public.bite_owner_approval_push_events(
  intent_id uuid PRIMARY KEY REFERENCES public.bite_order_confirmations(intent_id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  delivery_status text NOT NULL DEFAULT 'queued'
    CHECK(delivery_status IN ('queued','retry','processing','sent','failed','no_devices','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS bite_owner_approval_push_queue_idx
 ON public.bite_owner_approval_push_events(delivery_status,created_at);
ALTER TABLE public.bite_owner_approval_push_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bite_owner_approval_push_events FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION bite_private.enqueue_owner_approval_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $trigger$
BEGIN
 IF NEW.state <> 'pending' OR NEW.expires_at <= now() THEN RETURN NEW; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.bite_live_checkout_intents i
   WHERE i.id=NEW.intent_id AND i.customer_id=NEW.customer_id
     AND i.restaurant_id=NEW.restaurant_id AND i.confirmation_required
     AND i.status='awaiting_payment' AND i.provider_order_id IS NULL
     AND i.provider_attempted_at IS NULL
 ) THEN RETURN NEW; END IF;
 INSERT INTO public.bite_owner_approval_push_events(intent_id,restaurant_id)
 VALUES(NEW.intent_id,NEW.restaurant_id)
 ON CONFLICT (intent_id) DO NOTHING;
 BEGIN
  PERFORM bite_private.kick_owner_push_dispatch('pending_orders');
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Bite owner confirmation push dispatch could not be queued';
 END;
 RETURN NEW;
END $trigger$;
REVOKE ALL ON FUNCTION bite_private.enqueue_owner_approval_push()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bite_owner_approval_notification_on_request
 ON public.bite_order_confirmations;
CREATE TRIGGER bite_owner_approval_notification_on_request
 AFTER INSERT ON public.bite_order_confirmations
 FOR EACH ROW EXECUTE FUNCTION bite_private.enqueue_owner_approval_push();

-- Fallback for failed or interrupted pg_net dispatches. The approval deadline
-- is always checked again by the server before any FCM push is sent.
DO $cron_job$
BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='bite-owner-approval-push-retry') THEN
   PERFORM cron.schedule('bite-owner-approval-push-retry','* * * * *',$schedule$
     UPDATE public.bite_owner_approval_push_events
       SET delivery_status='retry',last_error='Recovered interrupted approval dispatch'
       WHERE delivery_status='processing'
       AND last_attempt_at < now()-interval '35 seconds' AND attempts<4;
     SELECT bite_private.kick_owner_push_dispatch('pending_orders')
       WHERE EXISTS (
         SELECT 1 FROM public.bite_owner_approval_push_events
         WHERE delivery_status IN ('queued','retry')
           AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '30 seconds')
       );
   $schedule$);
 END IF;
END $cron_job$;
