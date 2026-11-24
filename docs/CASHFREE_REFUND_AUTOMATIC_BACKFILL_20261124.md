# Cashfree refund completed → Bite-wide automatic status (24 Nov 2026)

## Current production gap
Signed Cashfree refund webhook + service-only refund observation RPC already exist. The three historic ₹1 requests still have no verified provider result. An existing five-minute auto-refund Cron has `auto_refunds_enabled=false`, so that issuer Cron deliberately does not run. We must NOT turn on refund issuance to solve a read-only status sync requirement.

## New recovery path
- Independent Vault-HMAC-signed Cron, once every 15 minutes, calls the **new mode** `{"action":"drain","mode":"reconcile"}` of the existing `bite-auto-refund` Edge Function.
- It does not use any customer token or accept a client-supplied order/refund ID; only existing scoped Bite refund jobs are selected by the service role, max six recent non-complete jobs per invocation, no older than 90 days.
- Validates a matching live non-demo Bite order, activated INR checkout, paid financial snapshot, amount, restaurant and customer before GETting the exact original PAID Cashfree order and matching refund ID.
- Requires exact Cashfree refund status, currency and amount and then calls the existing **service_role-only** idempotent `bite_record_verified_refund_observation` RPC. Only a verified provider SUCCESS can set `succeeded` and book refunded value once.
- A provider 404, mismatch or outage fails closed and never marks money refunded. Customer bank receipt remains separate from Cashfree provider processing.
- The separate already-merged PR #310 client loops update Customer, Owner and Super Admin views on focus and every 30/45 seconds while active. This is polling of existing scoped database rows, not an impersonated client notification.
- The new code makes **no provider refund POST**, no payout and no autoapproval; `auto_refunds_enabled` remains false.

## Release order
1. Exact-SHA CI and Node regression tests must pass. Independent signed-Cron validation and SQL privilege review required.
2. Deploy **Edge code first**: `bite-auto-refund` with `verify_jwt=false` preserved, since it implements its own user/scheduler auth.
3. Verify the old `run` and `drain` behavior is unchanged when auto refund issuance OFF. Confirm service RPC available/only service role.
4. Apply `supabase/patch_20261124_readonly_refund_status_cron.sql` through a single reviewed migration. It reuses the existing private Vault key; no signing material in SQL migrations or Cron commands.
5. Verify Cron run, HTTP response and privacy-safe counts. Test provider GET only against previously authorized real/sandbox records, not a new refund.
6. Check Customer/Owner/Super Admin show provider-verified refund on new records. Do not claim customer bank credit unless confirmed separately.

## Limitations
- A merchant refund created under a *different* provider refund reference is flagged for manual matching, not arbitrarily assigned by amount.
- A missing exact refund stays pending/review. It is not treated as a failed/refunded money movement.
- Six recent records per cycle; older than 90 days require manual reconciliation or future backlog pagination.
- This synchronizes **status of refunds already issued elsewhere**. It does NOT cause money to be sent. Creating refunds requires its separate authorization and issuer policy review.
