# Cashfree Refund Status → Bite-wide automatic synchronization (candidate)

Status: **implementation candidate; DO NOT treat as production-activated until all release gates pass**.

## Data flow
1. Cashfree sends `REFUND_STATUS_WEBHOOK` / `AUTO_REFUND_STATUS_WEBHOOK` to the **existing** `cashfree-webhook` endpoint. Current signed raw-body HMAC signature and timestamp checks happen before dispatch.
2. The webhook treats the event as a **hint only**. It matches a preexisting Bite refund job by exact provider refund ID; verifies customer/restaurant/activated checkout/paid financial snapshot; then GETs the Cashfree original PAID order and exact refund with server-only credentials.
3. A service-only PostgreSQL RPC `bite_record_verified_refund_observation` saves the verified provider status. Provider `SUCCESS` changes the financial snapshot and job **exactly once**, even if a refund was completed externally while Bite still said `pending_approval`. This is bookkeeping of a verified external event, **not permission to issue a new refund**. No Cashfree refund POST or payouts are ever sent by this new path.
4. Customer My Orders / Order Details refresh on visible foreground/focus and every 30 seconds while open. Owner Settlements & Refunds refresh on visible foreground/focus and every 30 seconds while open. Super Admin refund history includes completed outcomes and refreshes every 45 seconds after first load. All queries use the existing signed-in RLS scopes.
5. Provider `SUCCESS` means provider-processed, **not independently confirmed customer bank credit**. Restaurant payouts, settlement UTRs and fees remain separate and are not auto-certified.

## Release order and gates

- [ ] Run `refund-provider-sync-postgres-qa`, Node, Chromium and full Bite QA on exact head SHA.
- [ ] Review SQL RPC least privileges, exception audit, unknown/competing refund behavior, duplicate callbacks and provider GET-only mock tests. Do not enable new issuance of refunds or automatic payouts.
- [ ] Apply the reviewed `supabase/verified_refund_observation_candidate.sql` to production with a versioned, approved migration only **after** isolated tests and a clear rollback plan. Confirm the function's `EXECUTE` grant is **service_role only** and `authenticated` / `anon` cannot invoke it.
- [ ] **After SQL is installed**, deploy the matching `cashfree-webhook` Edge Function and imported `refund-event-sync.mjs` files (do not deploy the webhook before the RPC). Confirm the preexisting payment-success webhook still works.
- [ ] In Cashfree merchant webhooks, confirm exact production URL, signing secret environment, refund event subscriptions (`REFUND_STATUS_WEBHOOK` and `AUTO_REFUND_STATUS_WEBHOOK` as supported by the merchant) and successful deliveries. A checked-in code path does not itself configure Cashfree notifications.
- [ ] Verify a **synthetic/sandbox signed** refund event and provider GETs; then on an authorized existing real provider record use **read-only GET** acceptance with no new payment/refund/payout. Verify the database consumer/job/ledger view and all three UI roles match.
- [ ] Confirm provider data for any unmatched refund ID separately; never guess an order/customer/amount or backfill arbitrary external refunds.
- [ ] After production Edge and SQL gates pass, promote the frontend from the reviewed main branch, verify GitHub Pages exact SHA and guest/browser flows; authenticated device testing is still required.
- [ ] Verify offline/closed app behavior separately; the polling here does not promise background notifications or bank transfer receipt.

## Failure/rollback
- On invalid webhook signature, tenant, amount, currency or Cashfree GET: **no status or amount changes**; retry/review according to the error.
- Duplicate or late webhook cannot post refund money twice. The SQL locks the job and ledger. An already-recorded success never rolls backward.
- Previous nonzero financial refund amount with an unsucceeded job fails closed to avoid double counting.
- If callback format differs, keep production webhook on its previous version; examine Cashfree's real documented schema before adjusting hints.
- Roll back the Edge Function to its previous deployed version if needed; do not erase confirmed financial rows or manually reverse a recorded real refund. SQL function can remain restricted and unused while remediating.
- No raw webhook body, provider secret, phone number, bank details or customer PII should enter logs or issue comments.

## Known limitations
- Refunds without an existing, exact Bite job/reference are flagged `needs_reconciliation` and cannot be automatically assigned to an arbitrary order. This is intentional money safety.
- The helper assumes refund hint has a usable refund ID under `data.refund`, `data.refund_details` or `data.refund_id`; verify actual merchant event payload variant in controlled QA.
- This flow does **not** initiate refunds. Existing `bite-auto-refund` rollout remains disabled until separately approved.
- No new Supabase realtime table publication is required; polling updates the visible portals. Public/guest users do not receive private financial data.
