# Bite — Automatic Refund Operations Center (16 November 2026)

## Implemented and observed in production
- The existing `bite-auto-refund` Supabase Edge Function has an authenticated, **GET-only** Super Admin `preflight` action, per-order trusted matching, one-attempt DB claim and Cashfree idempotency key.
- Trusted eligibility is formed only by database transitions: customer cancellation before acceptance, restaurant rejection while `Received`, or Owner-accepted cancellation request.
- The private Vault-signed Supabase Cron schedule `bite-auto-refund-vault-dispatch` exists at a five-minute cadence; it skips when `public.bite_operations_config.auto_refunds_enabled=false`.
- At this audit, **production automatic refunds remain OFF** and all three existing ₹1 jobs are **not auto-authorized**: two `pending_approval`, one `approved`. Their provider statuses are unverified. No retrospective backfill is authorized.
- We have **not** issued any Cashfree payment/refund POST, altered a customer payment, enabled the production switch or modified existing refund jobs.

## New Super Admin view
Navigate to **Financials & Settlements → Refund status review**:
1. Click **Check automation status** to read the active ON/OFF flag and per-job rupee cap. This does **not** change the policy.
2. Click **Load refund requests**. Each job is marked `Manual review required` unless its `auto_authorized_at` and narrowly approved `auto_rule` exist. A historical approved job is **not** automatically eligible.
3. Click **Check Cashfree refund (read-only)** for exact preallocated provider-refund-ID lookup.
4. Click **Check automatic refund readiness** to run authenticated Edge `preflight` for that job's trusted order. It calls Cashfree **GET order** and **GET all refunds** only. The client insists on `refund_sent=false` and never invokes execute/refund/write actions.

A Cashfree `PAID_MATCHES_NO_REFUND` outcome confirms only the checked collection and refund history at that moment; it is **not** a bank credit, refund authorization, or platform/vendor settlement confirmation. `EXISTING_REFUND_RECORD` and any mismatch must stop further refund attempts until reconciled.

## Required production activation gates
Automatic money movement **must stay OFF** until all conditions have evidence:
1. Approved merchant account, live Cashfree payment/refund API, matching trusted order ID/INR/amount and actual collection against provider; investigate the historic ₹174 complaint and ₹1 jobs.
2. Confirm applicable merchant terms, refund amounts/fees, sufficient account/settlement availability and actual reconciliation method.
3. Separate controlled **sandbox** test, then authorized **live** test of a genuinely paid eligible order, including provider GET, refund POST idempotency, repeated GET and customer status. Verify no duplicate or premature success.
4. Explicit operator rollout acceptance to enable `auto_refunds_enabled` with a conservative rupee cap. Start with a single location and monitored volume; configure Cloud alarms or daily review.
5. Monitor the `bite_refund_jobs` queue, provider mismatch/errors, scheduler logs and unexpected partial refunds. Switch OFF immediately if provider checks conflict.

## Processing after a separately approved activation
A **new** trusted cancellation on a PAID live checkout creates a job with `auto_authorized_at` and an `auto_rule`; the authenticated customer can initiate a best-effort run and the signed scheduler retries pending states. The worker:
- Requires one verified matching live checkout and no other Cashfree refund.
- Atomically claims the job before the **only** provider POST, using an immutable provider refund ID and idempotency key.
- On uncertain responses, uses GET for the same ID, never a new payment/refund reference.
- Marks successful financial refund only on provider-verified `SUCCESS`. A Bank/UPI credit can still take additional time.

**Existing jobs never automatically become eligible after the flag changes.** They require an explicit Super Admin reconciliation/approval/manual-provider process. Do not update their `auto_authorized_at`, `auto_rule`, `attempts`, or `provider_refund_id` manually.

## Code & verification
- UI: `index.html`, `assets/admin-cashfree-audit.js`, `assets/admin-cashfree-audit.css`
- Tests: `scripts/admin_cashfree_audit.test.cjs`, `scripts/automatic_refund_policy.test.cjs`
- Provider docs: https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund and https://www.cashfree.com/docs/api-reference/payments/latest/refunds/get-refund
