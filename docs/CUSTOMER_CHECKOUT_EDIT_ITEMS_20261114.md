# Bite — Checkout Edit Items & Mobile Polish
Date: 2026-11-14

## Problem
The existing Bite cart already supported item quantities and cooking notes, but the checkout form offered only 'Back to menu'. Customers wishing to adjust an item had to navigate out of checkout and reopen their cart. Mobile checkout also needed clearer sections and touch-friendly delivery/pickup choices.

## Implemented
- Added **Edit items** directly beside the checkout close control. When not busy opening a payment, it uses the existing `closeCheckoutAndReturnToMenu()` and `openCartModal()` functions; existing cart quantities and cooking instructions remain available.
- If payment is currently opening, the action remains on checkout and displays a warning instead of interrupting an active payment handoff.
- Added a simple progress indicator: Menu, Cart, Details (current). This does not claim payment completion.
- Visually refined checkout summary, delivery/pickup radios, form fields, button hierarchy and mobile safe-area spacing.
- Kept the original server-authoritative price refresh, restaurant availability checks, coupon rules, checkout pending/success panels and online-only Cashfree flow. No COD introduced.

## Verification and limits
- New `scripts/customer_checkout_edit_items.test.cjs` checks action scope, parsing, accessible selectors, pending/busy guard and preservation of the sensitive checkout controls.
- Extended `scripts/browser_completion.py` to go from Checkout to Cart via Edit items and back to checkout in an **isolated synthetic test transport**, asserting the selected dish and quantity are preserved before verifying coupon totals and blocked test payment.
- Regular customer/browser CI, PostgreSQL regression and deployment jobs must be green before release.
- This change does not authorize payments, modify actual customer records, verify provider settlements, or certify mobile Core Web Vitals. Live authenticated device review is still needed.
