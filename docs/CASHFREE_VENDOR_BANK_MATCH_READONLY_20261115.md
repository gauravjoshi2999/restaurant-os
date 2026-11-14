# Bite — Cashfree vendor bank match (read-only, no transfer)
Date: 2026-11-15

## Production problem and evidence levels
The Bite project currently separates (a) paid checkout, (b) Cashfree merchant collection and bank settlement, (c) Easy Split vendor order entry, (d) matching vendor setup to the restaurant's intended bank profile, and (e) an independently verified restaurant bank credit.

The existing Super Admin `Check vendor split` confirms only an order-level vendor reference. The internally marked `restaurant_payout_profiles.approval_status='Approved'` is not Cashfree KYC, vendor activation or proof of payout. Do not infer that a vendor who appears in a split actually received a bank credit.

Cashfree official **read-only** GET vendor details API:
`GET /pg/easy-split/vendors/{vendor_id}` with version `2026-01-01`.
Documentation: https://www.cashfree.com/docs/api-reference/payments/latest/easy-split/get-vendor-all-details

Cashfree vendor detail responses can contain complete account numbers, contact details and KYC document IDs. **None of those raw fields may be returned to the frontend, saved in GitHub, used in telemetry, or shown to unauthorized accounts.**

## New verified backend flow
`bite-cashfree-operations` gains an admin-only `inspect_vendor` action. It accepts only the trusted Bite order UUID and candidate vendor ID, and requires these checks for every invocation:

1. Authenticated Super Admin (existing `auth.getUser()` + `is_platform_admin()`).
2. Non-demo Own Platform order associated with one activated, INR Cashfree checkout intent whose trusted provider order ID and amount match Bite's server records.
3. Independent Cashfree GET order response reports `PAID`, exact order ID, INR and expected amount.
4. Independent Cashfree GET Easy Split order response is valid, belongs to that paid order, and contains this exact vendor ID.
5. Independent Cashfree GET vendor details response reports the **same vendor ID**.
6. Server-side `service_role` fetches only the existing restaurant's saved `account_number` and `ifsc_code` from `restaurant_payout_profiles`. Compare them with the Cashfree vendor bank fields; never expose account numbers, IFSC, holder, phone, email or document values.

The result is only:
- `MATCH`: provider and Bite saved *bank settings* agree. **Still NOT verified**: bank ownership authorization, Cashfree KYC/activation, settlement UTR or restaurant bank credit.
- `MISMATCH`: bank destination differs; **STOP** mapping/payout until investigated.
- `NOT_COMPARABLE`: missing or invalid settings/unsafe numeric precision; do not infer a match.

Bank account values supplied as a JS number are only accepted if `Number.isSafeInteger()` is true; 16+ digit unsafe numeric values are never rounded into a false match.

All actions are manually initiated and read-only. Existing refund execution guards remain unchanged. No new SQL, payment, refund, transfer, mapping approval or database write is added.

## QA and release
- Node unit tests cover matching accounts, wrong account or IFSC, absent bank/profile, untrusted vendor ID, invalid status, unsafe numeric precision and JSON privacy.
- Super Admin mock tests cover deliberately invoked bank comparison, wrong vendor/block, bank MISMATCH STOP status, account-switch/refresh cleanup, and non-admin denial.
- Github Bite QA continues to run existing Node/static, Chromium customer/owner and ephemeral PostgreSQL tests.
- Confirm current deployed Edge Function is the expected GitHub code and `verify_jwt=true` before deploying the additive revision; verify exact deployed files afterwards.
- A GitHub merge does not prove GitHub Pages is deployed; confirm the expected exact JS cache version in the live workspace.

## What is still blocked
Live Cashfree Easy Split API calls need an authenticated Super Admin to choose a real paid order and its correct vendor candidate. The connected Supabase connector **does not expose Cashfree account records or Cashfree bank statements**; a new API feature cannot certify an unseen vendor's enrollment or bank credit. Vendor KYC and status require provider review, and a credit requires provider vendor settlement reference/UTR matched with the **restaurant bank statement**. Do not request or paste full PAN, passwords or bank account numbers in chat.

The previous `docs/sql/cashfree_vendor_candidates_staging_proposal.sql` is a **non-production design**, not a live vendor approval or settlement ledger. Keep it unapplied until independent staging, RLS acceptance and explicit approval.

**Go/no-go:** No restaurant may be marked `PAID` from this feature. It only reduces the risk of linking the wrong bank when the operator eventually confirms actual vendor setup.
