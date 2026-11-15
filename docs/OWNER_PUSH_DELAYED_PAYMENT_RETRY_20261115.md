# Bite — Owner push after delayed Cashfree payment verification

Date: 15 November 2026

## Root cause and production evidence

The live `bite_owner_push_on_new_order` trigger queues a push when a non-demo, Own Platform order is **inserted** with status `Received`. The `bite-owner-push-queue-dispatch` cron then calls `bite-owner-push-dispatch` each minute when events are queued/retrying. The Edge Function refuses to notify the restaurant unless the matching `order_financials.payment_status` is `paid` — which is necessary to avoid notifying unpaid orders.

Before this fix, a still-unverified payment exhausted the **same four-attempt budget used for FCM delivery failures**. An asynchronously verified customer payment could therefore miss its legitimate Owner notification if approval took more than a few minutes.

Live read-only snapshot: five historical push events, four `sent` and one `failed`. The historical failure had `Error: Order unavailable` after five attempts, not a confirmed delayed-payment failure. There are currently no pending or queued push events and no new paid orders awaiting Owner acceptance. **This is a preventive fix for a distinct defect confirmed in source, not a claim that the historical failure was caused by slow payment.**

## Code change

- Separate **payment-verification waiting** from ordinary FCM error handling.
- The owner dispatcher keeps an order in `retry` while payment remains unverified, bounded by **15 dispatch attempts and 25 minutes since outbox creation**.
- Do not relax critical safety rules: each dispatch still rereads the real order, requires status `Received`, channel `Own Platform`, non-demo order, and independent `order_financials.payment_status='paid'` before any Firebase message.
- When the payment never verifies, set `failed` with a precise `Payment verification window expired` reason; malformed/future timestamps fail closed. Do **not** dispatch an unpaid order.
- All unrelated Firebase send errors and unexpected exceptions keep the existing four-attempt budget. No retroactive message is sent to completed or canceled orders.
- The existing cron cadence (one minute, at least 50s between attempts) is unchanged. This is an Edge Function code-only change, not a database migration, payment, refund, test order or trigger write.

## Tests and release gates

`scripts/owner_push_payment_retry.test.cjs` tests a payment delay across attempts 4–14, expiry at 15/25 minutes, invalid/future timestamps and unchanged paid-order/real-order guards. The existing Bite QA continues to run Node/static, Chromium and PostgreSQL checks.

Deploy `bite-owner-push-dispatch` only after passing all PR checks and verifying live v8 source matches current `main`. This existing function is invoked by a protected private dispatch secret/DB cron and intentionally has `verify_jwt=false`; **do not change the dispatch authentication** in this limited fix. Recheck exact new version files after deployment. The read-only Owner Push Health function remains separate and should not be modified.

## Remaining proof

No simulated or real customer payment was performed. A real signed Bite Partner APK on a physical Android phone must receive a new legitimately paid order, then show its notification in background/locked state and permit authenticated accept/reject. A GitHub PR merge does not prove the Pages frontend is deployed.

If a real payment stays unverified beyond the bounded retry window, server reconciliation must be investigated; this feature does not mark any customer payment paid or requeue old failed events.
