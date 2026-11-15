# Bite — pending Cashfree refund status inspection (15 November 2026)

## Production finding
Read-only production reconciliation found one `pending_approval` refund request for the cancelled Own Platform order `BITE-C80BB5EB3413`. Refund amount is **₹1**, and the activated checkout reference matches the trusted order. `order_financials.payment_status` is internally `paid`, but there are **zero** independent Cashfree collection evidence records in `bite_provider_checks`. A `provider_refund_id` is already present in the refund job even though `approved_at`, `provider_checked_at`, and actual provider status are absent.

**Important**: Bite can preallocate a provider refund reference. Its existence does NOT prove that a Cashfree refund was sent or that the original payment reached the customer's bank. Blindly issuing another refund risks duplicate financial activity.

## New P0 safety check
A Super Admin may click **Financials & Settlements → Pending refund review → Load refund requests → Check Cashfree refund (read-only)**.

The new Edge Function action `inspect_refund` is allowed before refund approval, unlike the existing `check_refund` and `execute_refund` operations. It:

1. Requires signed-in platform admin, validates the exact job UUID from Bite's database, customer+restaurant ownership and one activated non-demo Own Platform checkout in INR.
2. Requires matching internal `order_financials.payment_status='paid'`, exact payable amount and a positive bounded refund amount.
3. Performs `GET /pg/orders/{trusted_order_id}` and checks Cashfree `PAID`, exact order ID, currency and amount.
4. Performs **only** `GET /pg/orders/{trusted_order_id}/refunds/{trusted_provider_refund_id}`:
   - HTTP 404 → `NO_PROVIDER_REFUND_RECORD` (does not authorize refund creation)
   - Matching provider record → `PROVIDER_REFUND_RECORD_FOUND` plus sanitized provider refund status
   - Any differing order/reference/amount/currency → hard 409 mismatch, no success state.
5. Returns `no_action_taken=true` and never changes approval, refund status, financial ledger or bank payout. No provider refund POST or Supabase financial writes occur.

The Super Admin table loads only on deliberate click, using existing row-level security. No customer address, bank account, PAN, full refund reference or provider credentials are displayed. Refund preview evidence is ephemeral and cleared when the login changes.

## What still requires the account owner
Inspect the provider status from your authenticated Super Admin session. If Cashfree reports refund already exists, reconcile that record instead of issuing a new one. If Cashfree reports 404, independently verify the original charge, beneficiary, any existing refunds and the intended ₹1 refund with Cashfree before approving a new refund. A read-only 404 is NOT blanket permission to pay or retry.

This release does not add an approval button, initiate a refund, enable `BITE_PROVIDER_REFUNDS_ENABLED`, or edit historic payment records. The merchant account's cash settlement and restaurant beneficiary still require separate bank matching.

## Release procedure
Require green GitHub Bite QA on the exact head SHA. Compare live `bite-cashfree-operations` code to current GitHub `main`; deploy only additive changes with `verify_jwt=true`; compare deployed source to PR, squash merge, then wait for the main push QA and GitHub Pages' static+live guest browser checks. Do not claim a public UI is live unless the latest Pages run's actual SHA and browser step pass.
