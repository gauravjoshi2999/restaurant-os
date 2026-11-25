-- One bounded, read-only provider investigation through the EXISTING signed
-- service worker. Run as the database operator; never expose this as a browser
-- RPC. Change only the integer offset (0, 6, 12, ...) after inspecting each reply.
-- No DDL, grants, Cron, refund switch, order activation or money API is changed.
-- The Vault key is consumed server-side and is never returned to the caller.
-- Deploy the reviewed worker and checkout-observation.mjs BEFORE running this.
with stamp as materialized (
 select extract(epoch from clock_timestamp())::bigint as ts
), signer as materialized (
 select decrypted_secret as value from vault.decrypted_secrets
 where name='bite_auto_refund_dispatch_key' and length(decrypted_secret)=64
)
select net.http_post(
 url:='https://wedbgpybbgsszcmffoha.supabase.co/functions/v1/bite-auto-refund',
 headers:=jsonb_build_object(
  'Content-Type','application/json',
  'x-bite-auto-refund-ts',stamp.ts::text,
  'x-bite-auto-refund-signature',encode(extensions.hmac(stamp.ts::text||':drain',signer.value,'sha256'),'hex')),
 body:=jsonb_build_object('action','drain','mode','checkout_inspect','offset',0),
 timeout_milliseconds:=90000
) as request_id from stamp cross join signer;
-- Inspect only net._http_response.status_code, timed_out, error_msg and content
-- for this returned request_id. Do not select queue headers or Vault secrets.
-- 404 means that exact provider reference was not found; it never proves a
-- customer's bank was not debited. No result authorizes a charge or refund.
