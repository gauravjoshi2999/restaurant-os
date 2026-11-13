# P0-2 POS payment reliability — first verified milestone

**Date:** 13 November 2026  
**PR:** [#16](https://github.com/gauravjoshi2999/restaurant-os/pull/16) (draft, not deployed)  
**Prior navigation PR:** [#14](https://github.com/gauravjoshi2999/restaurant-os/pull/14) (independent, draft)

## Problem found in existing code

The Owner POS **Add payment** flow previously inserted a new `restaurant_order_payments` row with a server-generated ID. If the insert committed but the response was lost, the owner saw a failure. The same handler also awaited `loadCloudData()` inside the insert's `try` block, so a post-save refresh failure could be reported as a failed payment. Retrying could record the same physical cash/UPI receipt twice.

A separate POS **new bill** flow already uses a stable draft-derived order code. The live database has a unique `(restaurant_id,order_code)` constraint on `orders`. This milestone targets the **additional payment** flow, which did not have equivalent client retry identity.

## Implemented safeguard

- Create a random UUID for each additional payment attempt and save it to device storage *before* the insert.
- Scope the pending record by signed-in user, restaurant and order. Persist only payment attempt metadata (amount, mode, date, reference and note), not card credentials.
- Include the same UUID in `restaurant_order_payments.id`; the database's existing primary key rejects duplicate submissions with that ID.
- If the network response is uncertain, query the receipt by UUID, order and restaurant; only matching amount/method/date/reference counts as confirmed.
- If still unknown, **do not** claim failure or mint a new UUID. Display **Check status**, preserve the original payment and reuse the same ID/details on retry, including after reload.
- If the database definitively rejects an attempt and reconciliation finds no row, clear the marker so the owner can correct the entry.
- Keep the post-save refresh separate from the payment result.
- Do not change existing database schema, production rows, online marketplace payments, cashbook closing logic or refund workflows.

## Scenarios and acceptance tests

| Scenario | Expected result |
|---|---|
| Normal partial payment, Cash/UPI | Exactly one receipt with correct amount, date and method |
| Network failure before commit | Pending warning; reload restores details; retry uses same ID |
| Network failure after commit | Reconciliation finds saved receipt; no second insert |
| Two rapid taps | Save disabled while in flight; one attempt |
| Duplicate ID error after late commit | Reconciliation confirms existing receipt |
| Database validation rejection | Error displayed, no successful receipt claimed |
| Storage unavailable | No insert; user told payment cannot be saved safely |
| Post-commit dashboard refresh error | Payment remains confirmed; refresh can be retried |
| Wrong owner/restaurant/order | UI blocks mismatch; database RLS/trigger remains authoritative |
| Closed day / cancelled bill / overpayment | Database guard rejects; no direct client override |
| Browser reload with pending attempt | Owner can check status and retry same receipt, not a new ID |

**Automation:** Node unit tests plus real Chromium synthetic mobile browser flow, run in the existing Bite QA workflow. Synthetic browser tests do not prove live bank reconciliation, payment gateway correctness or production RLS.

## Follow-up risks (not falsely marked complete)

1. Physical Android Chrome/APK smoke, weak-network and interrupted app lifecycle.
2. Verify real authenticated Owner vs Manager vs Staff RLS in a **staging** project using disposable test data. Do not write to production merely for QA.
3. Split payments are recorded as multiple individual receipts; the single-payment form does not yet support entering Cash+UPI simultaneously. Document this limitation in owner training.
4. Cross-device concurrency needs an audited server-side payment intent if a future product requirement demands exactly-once capture across multiple owners/devices. Client UUID protects retries of the *same attempt*, not separate intentional payment entries.
5. POS draft in-flight sync and stale cloud draft cleanup, plus correction/void end-to-end checks, remain next P0-2 subtasks.
6. End-of-day reconciliation, supplier milk ledger, staff salary advances and monthly reports remain later owner-first roadmap phases.

## Release gate

Do not merge or deploy until CI passes, mobile Owner signoff and staged database tests are complete. Neither GitHub PR creation nor synthetic QA constitutes production certification.
