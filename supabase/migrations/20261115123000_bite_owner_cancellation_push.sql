-- Bite Owner: customer-cancellation push outbox (future requests only).
-- Does not retroactively alert old requests, change orders, approve or refund.
create table if not exists public.bite_owner_cancellation_push_events(
 request_id uuid primary key references public.restaurant_customer_order_requests(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 delivery_status text not null default 'queued'
  check (delivery_status in ('queued','retry','processing','sent','failed','no_devices','skipped')),
 attempts integer not null default 0 check(attempts>=0),
 created_at timestamptz not null default now(),
 last_attempt_at timestamptz,
 sent_at timestamptz,
 last_error text
);
create index if not exists bite_owner_cancel_push_queue_idx
 on public.bite_owner_cancellation_push_events(delivery_status,created_at);
alter table public.bite_owner_cancellation_push_events enable row level security;
revoke all on public.bite_owner_cancellation_push_events from public,anon,authenticated;
-- Only the trusted service role may read or update the outbox.
grant select,insert,update on public.bite_owner_cancellation_push_events to service_role;
create or replace function public.bite_enqueue_owner_cancellation_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.request_type<>'cancel_request' or new.status<>'Pending' then return new; end if;
 -- The trigger does not trust a client-provided order reference or reason.
 -- A request can notify only the owner of its actual pending paid marketplace order.
 if exists(
   select 1 from public.orders o
   join public.order_financials f on f.order_id=o.id
   where o.id=new.order_id and o.restaurant_id=new.restaurant_id
     and o.customer_id=new.customer_id
     and o.status in ('Accepted','Preparing','Ready')
     and o.channel='Own Platform' and o.is_demo is not true
     and f.payment_status='paid' and f.restaurant_id=o.restaurant_id
 ) then
  insert into public.bite_owner_cancellation_push_events
   (request_id,order_id,restaurant_id)
  values(new.id,new.order_id,new.restaurant_id)
  on conflict(request_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.bite_enqueue_owner_cancellation_push()
 from public,anon,authenticated;
drop trigger if exists bite_owner_cancel_request_push on public.restaurant_customer_order_requests;
create trigger bite_owner_cancel_request_push
 after insert on public.restaurant_customer_order_requests
 for each row execute function public.bite_enqueue_owner_cancellation_push();

-- Reuse the existing Vault-signed, once-per-minute owner FCM runner.
-- Existing new-order queue and recovery are preserved.
do $$
declare v_job bigint;
begin
 select jobid into v_job from cron.job where jobname='bite-owner-push-queue-dispatch';
 if v_job is not null then
  perform cron.alter_job(job_id:=v_job,command:=$cron$
   UPDATE public.bite_owner_push_events
      SET delivery_status='retry',
          last_error='Recovered interrupted push dispatch'
    WHERE delivery_status='processing'
      AND last_attempt_at < now() - interval '2 minutes'
      AND attempts < 4;
   UPDATE public.bite_owner_cancellation_push_events
      SET delivery_status='retry',
          last_error='Recovered interrupted cancellation push'
    WHERE delivery_status='processing'
      AND last_attempt_at < now() - interval '2 minutes'
      AND attempts < 4;
   SELECT bite_private.kick_owner_push_dispatch('pending_orders')
    WHERE EXISTS (
      SELECT 1 FROM public.bite_owner_push_events
       WHERE delivery_status IN ('queued','retry')
         AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '50 seconds')
    ) OR EXISTS (
      SELECT 1 FROM public.bite_owner_cancellation_push_events
       WHERE delivery_status IN ('queued','retry')
         AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '50 seconds')
    );
  $cron$);
 end if;
end $$;
