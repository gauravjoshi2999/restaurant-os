# Bite — Cashfree Easy Split read-only audit (14 November 2026)

## Independent evidence and blocker

A read-only Supabase schema inspection shows `public.restaurant_payout_profiles` has bank/UPI details and an internal approval status, but **no Cashfree Easy Split vendor identifier**. Existing `restaurant_settlements` records, if any, are an internal accounting ledger, not independent provider disbursement proof. Therefore Bite currently has **no trusted restaurant → Cashfree vendor mapping**. Do not automatically create splits, promise a bank payout, or mark a restaurant paid.

Cashfree's official endpoint for read-only order-level Easy Split information is:
`GET /pg/easy-split/orders/{order_id}` with `x-api-version: 2026-01-01`.
Reference: https://www.cashfree.com/docs/api-reference/payments/latest/easy-split/get-split-and-settlement-details-by-orderid

The documented response has an order-level `settlement` object and `vendors[]` entries with `vendor_id`, `settlement_id` and `settlement_amount`. A vendor list, settlement reference, eligibility date, or merchant-side UTR **does not prove credit into the expected restaurant bank account**. Provider vendor identity, approved KYC, payout settlement UTR and an independently matched bank entry remain required.

## Implemented in this PR

- The existing admin-only `bite-cashfree-operations` function gains a non-mutating `inspect_split` action.
- The action accepts **only a trusted Bite order UUID**, not client-supplied vendor IDs, bank accounts or provider references. It independently checks the order is non-demo, belongs to the live Own Platform channel, maps to an activated Cashfree checkout intent, and that Cashfree reports `PAID` with the same amount/currency.
- Only then does it call Cashfree's GET Easy Split order endpoint. `404` becomes `NOT_FOUND` (not paid); other provider errors are reported as unavailable. A successful response is strictly validated against the trusted order ID/amount/currency and parsed into bounded, sanitized vendor references and amount snapshots.
- The handler explicitly returns `restaurant_payout: NOT_VERIFIED` and `bank_credit: NOT_VERIFIED`. It never creates vendor records, transfers, split instructions, refunds, or writes to Supabase.
- Super Admin Financials has an explicit **Check vendor split** button, separate from **Verify with Cashfree** collection check. The vendor records are shown only to Super Admin and only until refresh/session change. The payout column stays NOT independently verified.
- Node regression tests cover matched/mismatched provider order IDs, duplicate vendors, amount errors, missing fields, bank-claim safeguards, manual-only execution and role/session isolation.

No money moved, no customer paid, no financial records changed during implementation.

## Release and acceptance gate

1. CI must pass Node, Chromium and PostgreSQL checks for the exact PR SHA.
2. Compare the currently deployed Edge Function version with GitHub before replacing it. **A GitHub merge alone does not deploy a Supabase Edge Function.**
3. Deploy the changed function only after reviewing its existing refund branch and confirming that it remains gated; keep `verify_jwt=true`. Use a recorded release/rollback point and explicit permission for production function replacement if needed.
4. Manual Super Admin acceptance: deliberately inspect a known activated order, confirm whether Easy Split is approved in Cashfree and whether `NOT_FOUND`, denied access or actual vendor rows appear. A 404 does NOT prove failed customer payment.
5. Create a **separate verified mapping** between restaurant ID and provider vendor ID (with proper administrative approvals and RLS), then independently reconcile provider vendor settlement status/UTR with the actual restaurant bank. Do not add payout-by-bank-number auto-matching.
6. Vendor split creation and automatic transfers remain **out of scope and disabled** until Cashfree activation, signed commission/fee/refund terms, vendor bank verification and controlled staging acceptance.

This PR is evidence tooling, not proof that Easy Split is activated or that any restaurant has been paid.
