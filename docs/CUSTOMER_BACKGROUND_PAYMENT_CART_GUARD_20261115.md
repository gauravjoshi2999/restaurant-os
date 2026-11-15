# Bite — Background payment must not erase a new cart (2026-11-15)

## User-facing defect

Customer could return to the menu and assemble a fresh cart while a previous Cashfree checkout was being verified/cancelled in the background. If the previous payment eventually succeeded and **both carts happened to have the same restaurant, dish IDs and quantities**, `finishVerifiedCheckout` compared only the cart signature. It then emptied the fresh cart and notes, even though those items belonged to a different customer action. This could silently lose the next order.

## Safe fix

Record whether the customer has deliberately started a fresh cart using the existing `BiteCheckoutUX.freshCartRequested` flag. For a **background** verification of the old checkout, suppress clearing any fresh cart even when item signatures match. The preservation does not depend on whether the new checkout modal is visible.

Keep the normal payment completion logic unchanged: when a customer completes the checkout without a fresh cart, the paid old cart is still cleared, the modal closes and My Orders opens.

The previous payment is only marked completed if the trusted verification response says `activated` and contains `order_id`. This change never calls Cashfree, charges money, changes payment status, or creates new orders.

## Automated verification

New Node tests dynamically extract and execute the **real production `finishVerifiedCheckout` function** with safe synthetic DOM/test data, covering:

- Background old-payment activation + new cart with exactly identical restaurant/items/quantities while checkout visible.
- Same flow with the customer browsing the menu.
- Normal activation still clears the completed cart.
- A payment for a different restaurant cannot clear another restaurant's cart.
- Unverified payment throws and leaves the cart/pending checkout untouched.

Run `node --test scripts/customer_background_payment_cart.test.cjs` and the existing static, Chromium and PostgreSQL GitHub Bite QA. No live financial records or API operations are touched.

This fixes one concrete checkout regression. It does **not** certify the complete live payment E2E path or Cashfree settlement and vendor split.
