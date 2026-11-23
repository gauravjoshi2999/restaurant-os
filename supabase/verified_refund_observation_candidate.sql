-- Cashfree provider-observed refund status, no refund initiation.
-- Trusted callers MUST fetch the original PAID order and exact refund from
-- Cashfree first. This service-only RPC records external financial facts;
-- local approval is not a prerequisite for observing an already-refunded sum.
-- It never marks bank credit / restaurant vendor settlement.
create or replace function public.bite_record_verified_refund_observation(
 p_job_id uuid,p_provider_refund_id text,p_status text,p_amount numeric,p_currency text)
returns text language plpgsql security definer set search_path='' as $$
declare j public.bite_refund_jobs%rowtype;
        o public.orders%rowtype;
        i public.bite_live_checkout_intents%rowtype;
        f public.order_financials%rowtype;
        v_refunded numeric;
        v_next_status text;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
    and coalesce(auth.jwt()->>'role','') <> 'service_role' then
   raise exception 'Service role required';
 end if;
 if p_status is null or p_provider_refund_id is null
    or p_status not in ('SUCCESS','PENDING','PENDING_APPROVAL','CANCELLED','ONHOLD','REJECTED')
    or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount<=0 or p_currency is distinct from 'INR' then
   raise exception 'Untrusted provider evidence';
 end if;
 select * into j from public.bite_refund_jobs where id=p_job_id for update;
 if not found or j.provider_refund_id is distinct from p_provider_refund_id
    or j.amount is distinct from p_amount then
   raise exception 'Provider refund job mismatch';
 end if;
 if j.status='succeeded' then
   -- Duplicate and out-of-order events never reverse a recorded SUCCESS.
   if j.provider_status='SUCCESS' then return 'succeeded'; end if;
   raise exception 'Inconsistent previously recorded refund';
 end if;
 select * into o from public.orders where id=j.order_id;
 select * into i from public.bite_live_checkout_intents where activated_order_id=j.order_id;
 select * into f from public.order_financials where order_id=j.order_id for update;
 if o.id is null or i.id is null or f.id is null
    or o.channel<>'Own Platform' or coalesce(o.is_demo,false)
    or o.id is distinct from j.order_id
    or o.restaurant_id is distinct from j.restaurant_id
    or o.customer_id is distinct from j.customer_id
    or i.activated_order_id is distinct from o.id
    or i.restaurant_id is distinct from j.restaurant_id
    or i.customer_id is distinct from j.customer_id
    or i.status<>'activated' or i.currency<>'INR'
    or i.provider_order_id is distinct from 'bite_live_'||replace(i.id::text,'-','')
    or o.amount is distinct from i.amount
    or f.restaurant_id is distinct from j.restaurant_id
    or f.currency<>'INR' or f.customer_payable_amount is distinct from i.amount
    or f.payment_status not in ('paid','partially_refunded','refunded')
    or p_amount>i.amount then
   raise exception 'Original paid order and refund scope mismatch';
 end if;
 v_next_status:=j.status;
 if p_status='SUCCESS' then
   if coalesce(f.refund_amount_actual,0)<>0 then
     -- A different earlier refund or an ambiguous already-posted amount
     -- requires human reconciliation, never automatic double counting.
     raise exception 'Earlier refund total requires reconciliation';
   end if;
   v_refunded:=f.refund_amount_actual+j.amount;
   if v_refunded>f.customer_payable_amount then
     raise exception 'Refund exceeds original collection';
   end if;
   update public.order_financials
   set refund_amount_actual=v_refunded,
       payment_status=case when v_refunded=f.customer_payable_amount
                           then 'refunded' else 'partially_refunded' end
   where id=f.id;
   v_next_status:='succeeded';
 elsif p_status in ('CANCELLED','REJECTED') then
   -- Provider-declined attempts do not create an authorization for new money.
   v_next_status:=case when j.status in ('processing','submitted')
                      then 'failed' else j.status end;
 elsif j.status in ('processing','submitted') then
   v_next_status:='submitted';
 end if;
 update public.bite_refund_jobs
 set status=v_next_status,
     provider_status=p_status,
     provider_checked_at=clock_timestamp(),
     updated_at=clock_timestamp(),
     last_error=null
 where id=j.id;
 return v_next_status;
end $$;
revoke all on function public.bite_record_verified_refund_observation(uuid,text,text,numeric,text)
 from public,anon,authenticated;
grant execute on function public.bite_record_verified_refund_observation(uuid,text,text,numeric,text)
 to service_role;
