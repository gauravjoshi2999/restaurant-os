# H13 credit checkout release gate
Production audit: hotel folios are property-scoped; restaurant_customer_ledger_entries and customer balances require a restaurant_id. Hotel-only properties need not have a restaurant outlet. The present folio totals count only confirmed payment, advance and deposit application as receipts; current checkout requires zero balance, held deposit and pending receipt. A settled folio blocks new payments. Do not simulate a credit checkout with a cash receipt, discount, deposit or arbitrary restaurant assignment.

Required before enabling credit:
- Property-scoped canonical receivable tied uniquely to the original folio and guest. Explicit manager/owner authorization, reason, due date, immutable source and audit trail. No new sale or receipt at credit transfer.
- Atomic transaction under current property lock, stable request replay, current financial totals, room status and pending/deposit/refund/service guards. Invoice must distinguish actual receipts and receivable; do not issue false paid invoice.
- Guest-facing outstanding statement and role-checked recovery with separate verified cash/UPI receipt, closed-day guard and idempotency. Hotel daily book and combined business reports must include actual receipts exactly once, and never transfer hotel debt into restaurant-only Khata by default.
- Test hotel-only, hybrid, cross-property, restricted staff, concurrent receipts, altered retry, stale balance, selected room, original invoice preservation and no duplicate revenue.
- Until tests and authenticated acceptance are complete, block credit checkout. H13 checkout draft preview is available without recording a receipt.
