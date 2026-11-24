-- P0: independently poll real Cashfree refund statuses without issuing money.
-- Uses the existing Vault HMAC signer and service-only verifier; no tokens in Cron.
-- This job runs even when auto_refunds_enabled=false. It NEVER calls
-- the refund-issuance branch of the Edge Function.
-- Deploy the matching bite-auto-refund worker BEFORE scheduling this job.
create or replace function bite_private.dispatch_refund_status_reconciliation()
returns void language plpgsql security definer set search_path='' as $$
declare secret_value text;ts bigint;sig text;
begin
 if not exists(
  select 1 from public.bite_refund_jobs
  where status in ('pending_approval','approved','processing','submitted','failed','rejected')
    and provider_refund_id is not null
    and created_at > clock_timestamp() - interval '90 days'
 ) then return; end if;
 select decrypted_secret into secret_value
 from vault.decrypted_secrets where name='bite_auto_refund_dispatch_key';
 if secret_value is null or length(secret_value)<>64 then
  raise warning 'Bite refund status reconciliation skipped: scheduler signer missing';
  return;
 end if;
 ts:=extract(epoch from clock_timestamp())::bigint;
 sig:=encode(extensions.hmac(ts::text||':drain',secret_value,'sha256'),'hex');
 perform net.http_post(
  url:='https://wedbgpybbgsszcmffoha.supabase.co/functions/v1/bite-auto-refund',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-bite-auto-refund-ts',ts::text,
   'x-bite-auto-refund-signature',sig),
  body:='{"action":"drain","mode":"reconcile"}'::jsonb,
  timeout_milliseconds:=90000);
exception when others then
 -- Provider errors cannot alter the paid-order/refund ledger or block orders.
 raise warning 'Bite read-only refund status reconciliation unavailable: %',SQLSTATE;
end $$;
revoke all on function bite_private.dispatch_refund_status_reconciliation()
 from public,anon,authenticated;
-- One per 15 minutes, independently of refund-issuance scheduler.
select cron.schedule(
 'bite-refund-status-reconciliation',
 '*/15 * * * *',
 'select bite_private.dispatch_refund_status_reconciliation();');
