# Bite P0-3a — Owner Daily Cash Closing Review (13 Nov 2026)

## Why this is the next *one* feature

The existing live cashbook is already a tenant-scoped ledger backed by `restaurant_cashbook_entries` and `close_restaurant_cashbook_day`. It includes actual POS receipts, expenses, paid purchases, staff salary/advance/bonus, customer khata repayments and POS refunds. Online marketplace checkout is **not** assumed to be cash received. Do not rebuild or duplicate these sources.

The current Owner UI used `Number('') === 0`, allowing an empty **Counted cash** field to close a day at ₹0. It also cleared counted cash and notes when the opening field changed, did not require a reason for a discrepancy, and offered no review of the irreversible close.

## Change scope

- The Owner must type Counted Cash explicitly, including `0` when genuinely zero.
- All closing amounts are validated to two decimal places and summed as integer paise; negative expected drawer cash blocks review.
- Difference (Counted minus Expected) requires a meaningful 8+ character reason.
- Two distinct taps: **Review closing** then **Confirm & close day**. Review shows opening cash, actual Cash inflow/outflow, expected, counted, difference and reason. UPI/Card/Bank are not counted as physical cash.
- Review fetches fresh tenant/date-scoped ledger rows and closing state. Confirmation fetches again and invalidates the review if any row changed.
- Owner-only; Manager can view the cashbook but not close it. No changes to the POS/order payment flow, customer checkout, menu, WhatsApp, restaurant settings or existing database schema.
- Date switching invalidates review, while normal refresh on the same day preserves unsaved Counted Cash and note.
- A lost close RPC response is **not automatically retried**: query the closing row first. An already-closed day is shown as closed.

## Manual acceptance on real Android Owner app

1. Cashbook → select today. Enter opening ₹100, with one real cash receipt ₹50 and UPI ₹200. The review must show **expected cash ₹150**, not ₹350.
2. Leave Counted Cash blank → review blocked. Enter `0` → accepted as an explicitly entered zero only if the expected amount and discrepancy reason pass validation.
3. Counted ₹145 → must enter a discrepancy reason. Review shows `-₹5` (short); change any amount or note → confirmation disappears.
4. New cashbook entry arrives after review → confirmation refuses to close, refreshes and requires a new review.
5. Simulate a timeout **after** the server commits → status lookup reports closed; never submit a second RPC.
6. Verify Manager cannot close, Owner of another restaurant cannot see this restaurant, and Customer/Admin pages are unchanged.
7. Test Android back navigation and bottom nav together with Draft PR #14 only after both changes are merged/tested in an integration branch.

## Remaining backend gate — not addressed in this PR

This is **frontend protection, not an atomic accounting guarantee**. The existing RPC computes totals on the server, but a concurrent insert from a separate cashbook source can race with closing. Source triggers check whether a close already exists but do not share a per-restaurant/day lock. A future separate migration should serialize closing with **all** cashbook source writes, add a server-enforced discrepancy reason and source immutability checks, and test concurrency and retry idempotency in rollback-only SQL before deployment. Until then, a real-money closing feature should not be represented as fully race-safe.

No production database rows were changed by this PR. No changes from draft PRs #14 (mobile navigation), #16 (POS payment retries), or #18 (POS draft deletion) are assumed to be live.

## Release gate

- CI: Node pure-math + Owner UI integration tests and existing full Bite QA must pass.
- Real Android Owner smoke, Hindi/English text review, and cross-tenant RLS regression.
- Verify closed days remain immutable, no double-counting of online settlements, and no automatic retry after an uncertain response.
- Keep as Draft PR until owner acceptance. Merge/deploy separately; do not apply a database migration as part of this frontend change.
