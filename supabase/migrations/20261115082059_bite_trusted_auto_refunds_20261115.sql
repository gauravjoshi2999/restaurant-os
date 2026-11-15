-- Bite trusted cancellation -> auto-authorized refund queue.
-- This migration does not issue a Cashfree refund. Feature is OFF at rollout.
-- Pre-existing refund jobs remain unchanged and NEVER become auto-eligible.
alter table public.bite_operations_config
 add column if not exists auto_refunds_enabled boolean not null default false,
 add column if not exists auto_refund_max_amount numeric(12,2) not null default 2000.00
 check (auto_refund_max_amount >= 1 and auto_refund_max_amount <= 5000);

alter table public.bite_refund_jobs
 add column if not exists auto_authorized_at timestamptz,
 add column if not exists auto_rule text
 check (auto_rule is null or auto_rule in
 ('CUSTOMER_BEFORE_ACCEPTANCE','RESTAURANT_REJECTED','OWNER_ACCEPTED_CANCELLATION'));

create or replace function public.bite_queue_cancelled_refund()
returns trigger language plpgsql security definer set search_path='' as $$
declare f public.order_financials%rowtype;
 v_id uuid:=gen_random_uuid();
 v_auto_rule text:=null;
 v_enabled boolean:=false;
 v_limit numeric:=0;
begin
 if new.status in ('Cancelled','Rejected') and old.status not in ('Cancelled','Rejected')
    and not new.is_demo and new.channel='Own Platform' then
   select * into f from public.order_financials where order_id=new.id;
   if found and f.payment_status='paid' and coalesce(f.refund_amount_actual,0)=0
      and f.customer_payable_amount>0 and f.currency='INR' then
     -- Require an audited, trusted order transition rather than customer input.
     if old.status='Received' and new.status='Cancelled'
        and new.status_note='Cancelled by customer before restaurant acceptance' then
       v_auto_rule:='CUSTOMER_BEFORE_ACCEPTANCE';
     elsif old.status='Received' and new.status='Rejected' then
       v_auto_rule:='RESTAURANT_REJECTED';
     elsif old.status in ('Accepted','Preparing','Ready') and new.status='Cancelled'
        and new.status_note='Customer cancellation request approved by restaurant Owner'
        and current_setting('app.restaurant_cancel_request',true)='true' then
       v_auto_rule:='OWNER_ACCEPTED_CANCELLATION';
     end if;
     select auto_refunds_enabled,auto_refund_max_amount into v_enabled,v_limit
       from public.bite_operations_config where id=true;
     if coalesce(v_enabled,false) is false
        or f.customer_payable_amount>coalesce(v_limit,0) then v_auto_rule:=null; end if;
     insert into public.bite_refund_jobs
       (id,order_id,restaurant_id,customer_id,amount,reason,provider_refund_id,
        status,auto_authorized_at,auto_rule)
     values
       (v_id,new.id,new.restaurant_id,new.customer_id,f.customer_payable_amount,
        coalesce(new.status_note,'Order cancelled or rejected'),
        'bite_rf_'||replace(v_id::text,'-',''),
        case when v_auto_rule is not null then 'approved' else 'pending_approval' end,
        case when v_auto_rule is not null then now() else null end,v_auto_rule)
     on conflict(order_id) do nothing;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.bite_queue_cancelled_refund() from public,anon,authenticated;

-- Atomic one-attempt claim: use ONLY after trusted provider payment, refund GET
-- and refund-list read. Never let a browser claim a provider refund directly.
create or replace function public.bite_claim_auto_refund(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.bite_refund_jobs%rowtype; o public.orders%rowtype;
 f public.order_financials%rowtype; intent public.bite_live_checkout_intents%rowtype;
 config public.bite_operations_config%rowtype;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service only'; end if;
 select * into j from public.bite_refund_jobs where id=p_job_id for update;
 if not found or j.status<>'approved' or j.auto_authorized_at is null
    or j.auto_rule not in ('CUSTOMER_BEFORE_ACCEPTANCE','RESTAURANT_REJECTED','OWNER_ACCEPTED_CANCELLATION')
    or j.attempts<>0 or j.approved_by is not null or j.provider_checked_at is not null
    then return false; end if;
 select * into config from public.bite_operations_config where id=true;
 if not found or not config.auto_refunds_enabled or j.amount>config.auto_refund_max_amount then return false; end if;
 select * into o from public.orders where id=j.order_id;
 if not found or o.is_demo or o.channel<>'Own Platform' or o.status not in ('Cancelled','Rejected')
    or o.restaurant_id is distinct from j.restaurant_id or o.customer_id is distinct from j.customer_id
    or o.amount is distinct from j.amount then return false; end if;
 select * into f from public.order_financials where order_id=o.id;
 if not found or f.payment_status<>'paid' or f.currency<>'INR'
    or coalesce(f.refund_amount_actual,0)<>0 or f.customer_payable_amount is distinct from j.amount
    then return false; end if;
 select * into intent from public.bite_live_checkout_intents where activated_order_id=o.id;
 if not found or intent.status<>'activated' or intent.currency<>'INR'
    or intent.amount is distinct from j.amount
    or intent.provider_order_id is distinct from 'bite_live_'||replace(intent.id::text,'-','')
    or intent.customer_id is distinct from j.customer_id
    or intent.restaurant_id is distinct from j.restaurant_id then return false; end if;
 update public.bite_refund_jobs
 set status='processing',attempts=attempts+1,updated_at=now()
 where id=j.id and status='approved';
 return found;
end $$;
revoke all on function public.bite_claim_auto_refund(uuid) from public,anon,authenticated;
grant execute on function public.bite_claim_auto_refund(uuid) to service_role;

-- Service-only ledger finalizer retains all prior provider evidence matching and
-- exact-once success accounting. A trusted automatic eligibility is an
-- alternative to manual Admin approval, never a replacement for provider SUCCESS.
create or replace function public.bite_record_provider_refund(
 p_job_id uuid,p_provider_refund_id text,p_status text,p_amount numeric,p_currency text)
returns text language plpgsql security definer set search_path='' as $$
declare j public.bite_refund_jobs%rowtype;f public.order_financials%rowtype;v_new_refund numeric;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service only';end if;
 select * into j from public.bite_refund_jobs where id=p_job_id for update;
 if not found or j.provider_refund_id is distinct from p_provider_refund_id
    or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount<>j.amount or p_currency is distinct from 'INR'
    then raise exception 'Refund provider evidence mismatch';end if;
 if j.status='succeeded' then return 'succeeded';end if;
 if (j.approved_by is null or j.approved_at is null) and
    not (j.auto_authorized_at is not null and
      j.auto_rule in ('CUSTOMER_BEFORE_ACCEPTANCE','RESTAURANT_REJECTED','OWNER_ACCEPTED_CANCELLATION'))
    then raise exception 'Refund approval or trusted auto authorization required';end if;
 if j.status in ('pending_approval','rejected')
    then raise exception 'Refund authorization required';end if;
 if p_status not in ('SUCCESS','PENDING','PENDING_APPROVAL','CANCELLED','ONHOLD','REJECTED')
    then raise exception 'Unknown provider refund status';end if;
 if p_status='SUCCESS' then
   select * into f from public.order_financials where order_id=j.order_id for update;
   v_new_refund:=f.refund_amount_actual+j.amount;
   if v_new_refund>f.customer_payable_amount then raise exception 'Refund exceeds original payment';end if;
   update public.order_financials
   set refund_amount_actual=v_new_refund,
       payment_status=case when v_new_refund=f.customer_payable_amount then 'refunded' else 'partially_refunded' end
   where order_id=j.order_id;
 end if;
 update public.bite_refund_jobs
 set status=case when p_status='SUCCESS' then 'succeeded'
                 when p_status in ('CANCELLED','REJECTED') then 'failed' else 'submitted' end,
     provider_status=p_status,provider_checked_at=now(),updated_at=now(),last_error=null
 where id=j.id returning status into p_status;
 return p_status;
end $$;
revoke all on function public.bite_record_provider_refund(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.bite_record_provider_refund(uuid,text,text,numeric,text) to service_role;
