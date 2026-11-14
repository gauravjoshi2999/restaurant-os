# Bite — Payment Status and Account Switch Safety
Date: 2026-11-14

## Audit finding
Customer payment recovery persists a pending Cashfree checkout for the original customer in browser localStorage. The existing logout path cleared the in-memory payment state. However, a direct Auth transition from Account A to Account B skipped that cleanup. As a result, B could temporarily inherit A's pending-payment modal/banner or receive late asynchronous verification/cancellation messages. The server still restricts access by authenticated user; client cleanup is an additional safety layer.

## Implemented
- Every customer identity transition increments a payment-account sequence, clears the old in-memory intent/request key, quoted amount, coupon and private checkout contact/summary, closes the modal, resets payment busy/readiness flags and discards pending cancellation timers.
- The original user's pending intent remains persisted in their browser localStorage for **their own** later sign-in recovery. No real order or payment is erased from the backend merely because a customer logs out.
- Saved checkout recovery remains account-bound and is not replayed for a different authenticated ID.
- Delayed `bite-live-verify-checkout` responses are discarded if the signed-in account changed or the intent was replaced.
- Payment readiness responses cannot enable Pay online after an account transition.
- A delayed Cashfree session response cannot launch an SDK checkout after an account transition.
- Cancellation and background status polling may no longer display/update previous-customer status in the new account.
- Checkout preparation checks the current account sequence at key awaited boundaries before initiating new order/payment preparation. Existing payment, quote, order-activation, refund, split-settlement and OTP APIs are not changed.

## Verification
- `scripts/customer_payment_account_switch.test.cjs`: five executable Node VM tests using delayed/mock provider responses to cover Account A → B transitions, stale verification, Cashfree session creation, cancellation and gateway readiness. No real calls or charges are made.
- The prior `scripts/customer_p0_async_races.test.cjs` logout fixture now verifies payment/modal/intent cleanup.
- Existing `scripts/checkout_behavior.test.cjs`, `scripts/cashfree_cancel_flow.test.cjs`, `scripts/cashfree_session_freshness.test.cjs`, Chromium journeys and PostgreSQL regression remain release gates.
- Release only after PR QA, main-branch QA and a matching GitHub Pages deploy pass.

## Remaining launch sign-off
This is not a real-money provider certification. A manual authorized staging/live-payment checklist is still needed for provider onboarding, split-settlement approval, webhooks, refund outcomes and real Android/iOS browser transitions. No real payment, customer financial record or Supabase schema change was performed in this phase.
