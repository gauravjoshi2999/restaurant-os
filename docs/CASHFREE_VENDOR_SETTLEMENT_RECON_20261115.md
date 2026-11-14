# Bite — read-only Cashfree vendor settlement reconciliation
Date: 15 November 2026

## Provider API verified
Cashfree documentation: [Get Split and Settlement Details by Order ID v2.0](https://www.cashfree.com/docs/api-reference/payments/latest/easy-split/get-split-and-settlement-details-by-orderid-v20).

`POST https://api.cashfree.com/pg/split/order/vendor/recon` with `x-api-version: 2026-01-01` and `filters.order_ids=[trusted provider order ID]` is a **reconciliation reporting** request. It does not create vendor splits, refunds, transfers or settlements. Its response may include customer names, contacts, settlement reference and full UTR: none should be returned wholesale to the browser.

## Implemented
Authenticated **Super Admin only** → Financials & Settlements → choose a legitimate non-demo paid Own Platform order:
1. **Verify with Cashfree** checks customer collection.
2. **Check vendor split** reads the split entries of the exact paid order.
3. **Compare vendor ID** compares an administrator-entered candidate to the same order vendor list; does not permanently link a restaurant.
4. **Check Cashfree bank match** securely compares provider vendor bank/IFSC to this restaurant saved payout profile, without returning account numbers.
5. **Check vendor settlement** appears only after a `MATCH`. A brand-new backend `inspect_vendor_recon` call **rechecks** PAID order, trusted checkout ID, vendor membership in the split, provider vendor identity and restaurant bank match before querying the provider reconciliation endpoint.

Response handling fails closed on foreign order, currency/amount mismatch, multiple vendor records, partial pagination, no matching vendor, missing successful settlement record, or missing valid UTR. Results are distinct:

- `PROVIDER_NOT_SETTLED`, `NO_VENDOR_RECON_ROW`, `PAGINATION_INCOMPLETE`, `MULTIPLE_VENDOR_RECON_ROWS` → not paid;
- `PROVIDER_SETTLEMENT_EVIDENCE_INCOMPLETE` or `PROVIDER_STATUS_UNCLEAR` → manual review;
- `PROVIDER_REPORTS_SETTLED` → **only what Cashfree reports**, not proof of independent restaurant bank credit.

The full provider UTR stays on the server. The browser receives at most its last four characters and a provider settlement reference. An **optional** administrator-entered bank-statement UTR is compared server-side in memory, returning only `MATCHES_OPERATOR_INPUT` or `DIFFERS_FROM_OPERATOR_INPUT`. Input is not retained in the UI after submission, stored, logged or copied into any financial table. A match is still not independent verification that the administrator's UTR actually came from the expected beneficiary's bank statement. The user must separately authenticate the bank statement/credit.

## Safety and scope
- Do not label `restaurant_settlements`, payout profile, vendor KYC, order, or bank credit **PAID** from a provider report or operator-entered text.
- No new production SQL migrations, table writes, refunds, vendor splits or bank transfers.
- Supplier KYC, signed beneficiary approval, external bank reconciliation, exact vendor mapping and Cashbook locking are independent launch gates.
- Node, browser and ephemeral PostgreSQL regressions required; GitHub merge is not GitHub Pages deployment proof.
- Deploy the Edge Function only after existing version and existing refund/collection branches are verified unchanged, keep JWT required and compare deployed source files to the successful PR exact SHA.
- The connected Supabase account provides no authenticated Cashfree dashboard session or bank statement, so real payout recognition must remain pending until the operator runs the verified order flow and bank independently confirms the credit.

This is read-only **evidence tooling**, not activation of Easy Split.
