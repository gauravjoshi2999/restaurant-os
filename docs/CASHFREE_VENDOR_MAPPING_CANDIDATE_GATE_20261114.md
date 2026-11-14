# Bite — Cashfree vendor candidate comparison, release gate (14 Nov 2026)

## Production read-only snapshot

- `restaurant_payout_profiles`: 1; internal `approval_status='Approved'`: 1.
- `bite_provider_checks`: 0.
- `restaurant_settlements`: 0; `restaurant_settlement_items`: 0.
- `bite_live_checkout_intents` with `status='activated'`: **7** as observed on 14 November 2026 (changed since the previous five-order audit).
- No dedicated `bite_cashfree_vendor_mappings`/equivalent mapping table was found.

These counts are time-specific; they do not establish a bank payout, merchant settlement, active Easy Split subscription, provider KYC or vendor-to-restaurant identity mapping. A profile marked Approved inside Bite is **not Cashfree approval**.

## Delivered UI guard

Super Admin → Financials & Settlements → specific eligible non-demo paid order:

1. **Check vendor split:** explicitly invokes existing admin-only `bite-cashfree-operations` action `inspect_split`; the backend verifies the exact trusted Bite order, activated checkout reference, Cashfree PAID collection, currency and amount, then reads the provider's order split record via GET.
2. When Cashfree returns a validated vendor list, **Candidate Cashfree Vendor ID** input appears. The operator enters a vendor ID already obtained from the Cashfree merchant dashboard and clicks **Compare vendor ID**. This is a local comparison against **that order's** provider list.
3. A match means only **"vendor ID appears in this provider order's split"**, not verified Restaurant identity, KYC, account number, actual net payee, UTR or bank credit. A mismatch explicitly warns not to link the restaurant.
4. The candidate is **not saved to localStorage, Supabase, checkout, order financials or any payout table**; it disappears on refresh/account switch/logout and cannot initiate a split, transfer or refund.
5. Neither Owner nor Customer can access this admin-only UI; the Edge Function independently verifies the real admin session and known order reference.

## Production gate for a durable mapping and actual payout

Durable linking remains intentionally **NO-GO** until independent evidence is available:

- Confirm Cashfree Easy Split is enabled for the correct merchant; verify the candidate `vendor_id` in the merchant's Vendor dashboard together with provider KYC/activation and the intended restaurant's approved banking destination. Do not infer these from a matching order ID alone.
- Obtain consent/verification from the restaurant business owner for the exact intended payout beneficiary. Avoid posting full bank account numbers, PAN or other KYC secrets into issues, chat, logs or the public repository.
- Require authorized, audited server-side mapping workflow: `restaurant_id` ↔ Cashfree `vendor_id` with uniqueness, evidence reference, non-transferable approval and explicit revocation; protect it with admin-only RLS and a second approval or independently reviewed Cashfree vendor/bank record. Keep split/payout actions disabled until verified.
- Reconcile Cashfree vendor settlement status/reference and UTR against the **specific restaurant bank credit** and contractual commission/refunds. Provider split rows, settlement IDs and a merchant-bank UTR do NOT prove the restaurant bank was credited. A manual bank statement reconciliation is required.
- Only after staging, signed terms, provider approval, automated tests, production change authorization and monitored rollout should future splits or settlements be enabled.

Cashfree official Easy Split vendor and reconciliation overview: https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview

**This PR is a read-only comparison and fail-closed UI guard, not a bank mapping database migration or a claim of actual Easy Split settlement.** No provider refund or transfer API is invoked; no new database tables or financial records are written.
