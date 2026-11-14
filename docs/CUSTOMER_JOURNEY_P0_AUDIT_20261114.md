# BITE — Customer Journey P0 Audit & Fixes
Date: 2026-11-14
Branch: `fix/bite-customer-p0-pin-race-20261114`
Production baseline: `942660935d41a19b3860131f00d5408ef8d67ed2`

## Source hierarchy and inspection
Reviewed the actual `main` code of `customer.html`, `assets/customer-completion.js`, `assets/customer-premium.js`, `assets/customer-discovery.js`, relevant Chromium/Node tests, `README.md`, `docs/PRODUCT_BLUEPRINT.md`, `docs/DEEP_QA_REPORT_20261109.md`, `docs/CUSTOMER_MENU_SEARCH_CART_DISCOVERY_20261114.md` and `docs/checkout-v3-priced-staging.md`. Earlier reports are historical evidence and **do not certify the current live paid customer journey**.

## Confirmed P0 defects in the baseline

| ID | Priority | Reproduction / code evidence | Implemented correction |
| --- | --- | --- | --- |
| C-P0-01 | P0 | In an out-of-service PIN, the `Change PIN` button (`data-discovery-pin`) focused `#discoveryPinInput`. That field now lives inside a deliberately hidden `#discoveryLocationForm`, so nothing usable opened. | Route the button to the actual visible and keyboard-accessible `#biteLocationOpen` location sheet. |
| C-P0-02 | P0 | `loadRestaurants()` had no async request guard. Slow Supabase storefront/menu/legacy-zone responses for an old PIN could replace the newer results after a PIN change. | A monotonically increasing request token + captured PIN ensures only the newest response can commit restaurant, category and menu data together. Old errors cannot overwrite current success. While a PIN refresh is pending, old restaurant cards and autocomplete suggestions are not shown as available. |
| C-P0-03 | P0 | In Pickup mode, restaurant card delivery status derived only from `accepts_delivery` and `delivery_paused`, even if `serviceable=false` for the selected PIN; card could say `Delivery · Pickup` and display an unverified fee. | Advertise available Delivery only if PIN has been selected and `serviceable===true`. Otherwise show Pickup or advise PIN verification. Delivery fee stays noncommittal until the area is serviceable. |

## Customer journey feature audit

| Journey | Code observation | Remaining release validation |
| --- | --- | --- |
| Discovery/search/categories | Supabase-backed public storefront; local menu search index; category filters/scroll, veg/rating/sort; PIN serviceability from the storefront or fallback area RPC. The three P0 failures above are fixed on this review branch. | Successful browser QA, actual slow-network/mobile verification, real restaurant catalog correctness. |
| Delivery address | Header location sheet supports manual 6-digit PIN and RLS-backed saved-address list for signed-in users; checkout independently validates delivery area. | Authenticated Home/Office address test, denied-geolocation UX, manual phone check. |
| Restaurant/menu | Loaded from `menu_categories` and available `menu_items`, with restaurant scope; price is rechecked before checkout. | Menu-photo provenance/coverage and real mobile visual review. |
| Cart | Existing single-restaurant switching confirmation, saved cart, quantities, cooking notes and add-ons operate on available menu data. | Physical back/reopen tests; pending-payment/cart-switch regressions on real devices. |
| Checkout | Existing online-only payment gate, server price/area checks, busy/pending statuses and safe cancellation/status verification. No COD. | **Blocked for final payment sign-off:** independently verify approved Cashfree marketplace onboarding, settlement split, provider callback, refunds and an authorized isolated paid E2E test. |
| Account/auth | Supabase Auth, profile and address operations, recovery flow exist. | New real-account signup, email deliverability, recovery link, rate-limits and session retention; **not certified** by public browser tests. |
| Orders/support | Tenant-scoped customer order RPC, order status/history, invoice, reorder, cancellation/review/complaint UI. | Authenticated browser/mobile tests with a real customer-owned order; review support ticket status. |
| Device/accessibility/performance | Existing desktop/mobile Chromium smoke, CSS focus/reduced motion and fixed image dimensions. | Physical Android/iPhone test, WCAG 2.2 AA audit, LCP/INP/CLS and Lighthouse measurement; no performance target claims yet. |

## Changes in this PR
- `customer.html`: race-safe, atomic PIN-scoped restaurant discovery, visible Change PIN recovery, accurate service/fee labeling and stale-result loading state. All original restaurant/menu RPCs and direct restaurant routing preserved.
- `assets/customer-premium.js`: don't offer old search suggestions while the delivery area is loading.
- `scripts/customer_delivery_pin_p0.test.cjs`: executable simulated async tests: immediate loading state, out-of-order storefront responses, delayed old menu fetch, old failure after new success, and source-level checks.
- `scripts/browser_completion.py`: checks that Change PIN opens the real sheet, Escape closes it, and out-of-area Pickup cards do not present delivery as available.
- No SQL migrations, Supabase credentials, Auth/RLS changes, merchant onboarding, payment/refund operations, Owner/Admin changes or price modifications.

## Acceptance and release gates
1. Run `node --test scripts/*.test.cjs` plus existing Python frontend guard and Chromium completion/smoke suites.
2. Run existing PostgreSQL security/owner/customer regressions in the workflow.
3. Confirm PR CI passes; merge into `main` only after that.
4. Confirm **main** CI and the exact SHA's GitHub Pages deployment pass.
5. Manually inspect authenticated Android/iPhone flows; measure accessibility/performance before final master-prompt completion.
6. **Do not declare paid marketplace launch-ready** merely because static website deployment succeeds.

## Explicitly unverified
This code audit is not a full real-money provider test, a login/email recovery integration test, a human visual audit of every menu photo or a complete production security certification.
