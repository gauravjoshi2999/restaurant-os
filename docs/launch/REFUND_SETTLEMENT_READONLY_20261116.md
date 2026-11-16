# Bite — Refund, Gateway Fees and Restaurant Settlement Audit (read-only)

Audit date: **16 November 2026 (Asia/Kolkata)**.
Project: `wedbgpybbgsszcmffoha`.
No provider API call, real payment, refund, bank account edit, settlement write or order status change was executed.

## Production database results

| Control | Current observed state |
| --- | --- |
| Non-demo `order_financials` rows marked `paid` | **11**, with recorded payable totals **₹184.00** |
| Of these, rows with `customer_payable_amount=174` | **1** (recorded as paid in app database) |
| Paid non-demo rows with no `provider_fee_actual` | **11 / 11** |
| Paid non-demo rows with `settlement_status='not_ready'` | **11 / 11** |
| `restaurant_settlements` | **0** rows |
| `bite_refund_jobs` | **3** jobs, **₹3** total |
| Refund jobs with `status='pending_approval'` | **2** jobs, ₹2 |
| Refund jobs with `status='approved'` | **1** job, ₹1 |
| Refund jobs with provider-confirmed completion status | **0** |
| Refund jobs with blank `provider_status` | **3 / 3** |
| Restaurant payout profiles with status `Approved` | **1** |

**Important distinctions**
1. `paid` in a local table is not independent proof that Cashfree collected the amount, remitted a split, or credited a restaurant bank account.
2. A locally `Approved` payout profile is not proof Cashfree Easy Split vendor onboarding or bank-side settlement is approved.
3. A refund job created or approved internally is not proof the provider submitted or completed the refund. Empty `provider_status` is an unknown outcome, not proof of failure or success.
4. The ₹174 record matches the historical owner complaint in amount, but do **not** assert it is the same transaction without matching Cashfree order/payment identifiers. Neither actual platform bank credit nor restaurant payout was independently checked.
5. Some low-value rows may be tests; `is_demo=false` does not alone establish real cash movement.
6. Absence of a `restaurant_settlements` row means none was found in that database table; it does not prove no manual/off-platform bank payout happened.

## Production readiness gates
- [ ] Obtain provider-issued evidence for every relevant non-demo `paid` record and specifically reconcile the ₹174 payment against trusted Cashfree order/payment identifiers.
- [ ] Verify actual gateway charges from Cashfree fee records before setting `provider_fee_actual`. **Do not default missing fee to zero**.
- [ ] Check provider refund ID, provider status and bank/customer credit for all three refund jobs before any retry or refund UI completion claim.
- [ ] Verify restaurant vendor KYC, splitting configuration and approved payout destination in Cashfree merchant portal.
- [ ] Reconcile restaurant payable, platform commission, payment fees, refunds and settlement reference for a controlled verified order.
- [ ] Do not independently issue repeated real-money payments or refunds in an attempt to test configuration; only approved operator/provider reconciliation can resolve unknown settlement states.

**Conclusion:** Read-only status inventory complete. **Real payment/refund/split settlement acceptance remains BLOCKED pending provider evidence.** No real-money side effect was performed.
