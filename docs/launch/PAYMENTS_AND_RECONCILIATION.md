# Payment collection, settlement and payout

## Fresh database check during this work

Historical reference supplied in the execution brief: `BITE-4603E02B91E0`, Cashfree payment reference `6957461881`. The provider transaction reference was not freshly authenticated against Cashfree in this session.

| Database evidence | Result |
| --- | --- |
| Order total / food / delivery | ₹174 / ₹149 / ₹25 |
| Order / collection status | Completed / paid; associated checkout activated |
| Commission booked | ₹14.90 |
| Recorded actual gateway fee | Unknown / null |
| Recorded actual refund | ₹0 |
| Database settlement status | not_ready |
| Restaurant settlement batches | 0 at the fresh check |
| Restaurants without payout profiles | 11 at the fresh check |

These are application records, not a fresh bank statement or provider settlement response. Missing restaurant payout setup does not establish why Cashfree has or has not credited the platform's merchant bank. Do not call the money lost, settled or transferred without its evidence.

## Daily reconciliation procedure

1. Admin opens Platform Finance, selects the exact order and requests the trusted provider check. The staged function resolves the provider reference from that order's activated intent; it does not accept an arbitrary provider order ID from the browser.
2. Compare provider order ID, INR currency and exact amount with the immutable intent and order total. A mismatch stops the check.
3. Inspect collection and linked platform-bank settlement separately. Preserve the provider settlement ID, status, UTR and timestamp in restricted evidence. Personal contact/bank-account payloads are excluded.
4. Confirm merchant-bank credit against the bank statement/UTR. A PG settlement to the platform does not prove a restaurant payout.
5. Confirm restaurant KYC/vendor mapping, approved bank details, approved marketplace agreement, actual fee treatment and payout evidence. Ordinary PG collection alone is insufficient. Do not transfer restaurant money through an unapproved workaround.
6. Resolve mismatches as incidents; preserve provider references and signed callback logs without secrets. Never manually mark an order paid to hide a mismatch.

## Refund state machine

`pending_approval → approved → processing → submitted → succeeded / failed`

A cancelled/rejected paid live order queues a refund review; this does not refund it. Admin can also create an amount-bounded review request for an eligible order. A different explicit decision approves it. Provider execution additionally requires `BITE_PROVIDER_REFUNDS_ENABLED=true` and an exact execution confirmation. Defaults do not permit real execution.

The provider refund ID and idempotency key are stable. A competing claim cannot issue another POST. An uncertain attempt is checked using the same reference; an eligible stale processing retry reuses the same ID/key. A successful creation response is re-read from the provider. INR amount, original provider order and refund reference must match. Only provider SUCCESS applies the amount atomically to the financial record, once. Pending/rejected/unknown responses are not successful refunds.

One review job per order intentionally prevents parallel duplicate refund requests. A second partial adjustment or manual provider-side refund requires a reviewed reconciliation extension; operators must not invent a new job/reference to bypass this restriction.

## Commercial/provider gates

Easy Split approval, vendor onboarding/KYC, bank verification, split instructions, vendor settlement webhooks, actual restaurant payouts, taxes and fee allocation remain unverified/not active. The session endpoint currently integrates ordinary Cashfree PG collection; it does not claim to create an approved marketplace split. Do not launch a nationwide marketplace or promise next-day payouts from this code alone.

Official implementation references, checked during this work:
- [Create order, including expiry/idempotency and approved Easy Split option](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order).
- [Refund operation](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund).
- [Linked settlement by order](https://www.cashfree.com/docs/api-reference/payments/latest/settlements/get-settlements-by-order-id).
- [Marketplace Easy Split overview](https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview).
- [Merchant terms](https://www.cashfree.com/tnc).

No real charge, refund, transfer or financial-record correction was executed as part of this branch.
