# Bite — Cashfree Collection vs Restaurant Settlement Verification

Date: 2026-11-14
Scope: Super Admin **Financials & Settlements** only. No customer/owner checkout change, refund or money movement.

## Live read-only database audit
- `bite_live_checkout_intents`: 5 activated; 9 awaiting_payment; 14 expired.
- Each of the 5 activated intents has an associated order and provider order reference.
- `order_financials` has 5 non-demo Own Platform rows with `payment_status='paid'`.
- `bite_provider_checks`: **0** records; no independent Cashfree provider reconciliation stored yet.
- `restaurant_settlements`: **0** records; `restaurant_settlement_items`: **0**.
- `restaurant_payout_profiles`: 1 profile. Profile existence alone does not indicate that Cashfree vendor onboarding or bank transfer succeeded.
- Aggregate counts are snapshots from the audit date. They are not proof of bank credit or of vendor payout.

## Important interpretation
There are **four distinct things** that should never be conflated:
1. Bite checkout intent / order activation.
2. Cashfree payment collection independently verified by its API.
3. Cashfree settlement of the merchant/platform's money to a bank account.
4. The **restaurant vendor's** share paid to the restaurant bank account, subject to Easy Split vendor onboarding and split instructions.

A successful checkout or Cashfree merchant collection **does not prove** #3 or #4. A `restaurant_settlements` draft or recorded fee also does not prove a transfer. Cashfree Easy Split offers separate vendor split and settlement details APIs; these are not yet integrated as independently verified restaurant payout evidence.

Official Easy Split reference: https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview

## Implementation
- New `assets/admin-cashfree-audit.js` + CSS and a dedicated section in the existing Super Admin **Financials & Settlements** page.
- The queue is built from existing non-demo, `Own Platform`, `paid` order financial snapshots and the existing platform-admin-visible orders.
- Recorded provider checks are read from `bite_provider_checks` through the existing admin-only RLS; there is **no** expansion of customer-only `bite_live_checkout_intents` RLS.
- Every row distinguishes Bite recorded paid amount, Cashfree collection checked (PAID and amount matched), merchant settlement evidence (never assumed to mean a bank deposit) and restaurant payout **NOT independently verified**.
- The **Verify with Cashfree** button explicitly invokes the existing, already deployed `bite-cashfree-operations` Edge Function with `{action:'reconcile', order_id}`; it does not run automatically. The function validates `is_platform_admin()`, fetches Cashfree provider GET evidence and stores a `bite_provider_checks` audit record.
- No function action for refund, transfer, Easy Split creation or vendor registration is exposed in this UI.
- Session changes and admin-only page access guard against stale account data; the queue is cleared on sign-out.
- Current frontend list is bounded to 100 eligible orders, and the check query to 500 recent records. Reconcile older periods through the back office/provider export until pagination is added.

## Tests and acceptance
- `scripts/admin_cashfree_audit.test.cjs` uses deterministic local mock data and asserts (a) no provider request on page load, (b) owner/signed-out cannot access audit records, (c) only explicit user action calls `action:'reconcile'`, (d) wrong amount never counts as verified, and (e) even a provider settlement SUCCESS does not mark the restaurant bank payout verified.
- Full GitHub PR/main CI: static scripts, Node suites, Chromium customer/owner synthetic journeys, ephemeral PostgreSQL regression, matching GitHub Pages deployment.
- Manual Super Admin session acceptance is still required. **No real Cashfree API was called or customer/provider financial data modified by automated tests.**

## Launch-blocking next actions
1. Confirm Cashfree Easy Split approval, vendor activation and the restaurant's verified `vendor_id` / assigned bank record **inside Cashfree**. A stored payout profile is insufficient.
2. Agree and sign the commission rate/base, discount responsibility, actual processing fees, settlement cycle and refunds with each restaurant.
3. Integrate a **separate**, read-only Easy Split vendor settlement evidence lookup and match each restaurant's bank/UTR. Do not create transfers or infer a vendor payout from the merchant settlement endpoint.
4. Reconcile each activated payment against Cashfree with a signed-in platform admin, then compare provider records/bank statement. Investigate pending or expired intents with provider references without collecting again.
5. Authorize and document a controlled live test after external provider readiness, with refunds and rollback plan. Do not use random real customer charges for QA.

This is a **readiness and evidence** improvement, not a claim that automatic payment splitting is enabled or that any restaurant has been paid.
