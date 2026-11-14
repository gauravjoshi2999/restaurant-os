# Bite — Customer Order History & Image Stability (Phase 3)
Date: 2026-11-14

## Audit findings (from current repository code)
- `customer.html` already uses the authenticated `list_my_customer_orders` RPC, renders actual customer order status, supports detailed status history, reorder, invoice, cancellation requests and restaurant reviews.
- The existing order list has no status filter or on-page order/restaurant search. The user must scan every order.
- Restaurant cover cards and dish thumbnails use lazy/async image loading but lacked intrinsic dimensions. The large home hero has loading priority; the hidden restaurant hero had eager loading.

## Implemented
1. **Order History toolbar** — All orders, Ongoing, Delivered and Cancelled quick filters, plus a search for restaurant name or order code. Explicit mapping: Received/Accepted/Preparing/Ready/Handed Over are ongoing; Completed/Delivered are delivered; Cancelled/Rejected are cancelled. Unknown statuses remain accessible in All orders, rather than being mislabeled.
2. **Real results only** — filters operate on the existing authenticated order cards, using their visible code/restaurant/status. They issue no additional API requests and never alter order or payment data.
3. **Accessible feedback** — selected filter state, live visible-order count and an actionable clear option when the current filter has no matches. The original true-empty state, loading state, error message, order actions and details are preserved.
4. **Mobile polish** — original Bite colors, 44px filter/buttons, responsive order cards and horizontally scrollable status chips.
5. **Food imagery stability** — intrinsic width/height for restaurant covers and menu food images, async decode on menu images and lazy load for hidden restaurant hero. Preserve the home hero's priority.
6. **Regression checks** — `scripts/customer_history_premium.test.cjs` covers filtering/state/accessibility and image markup. `scripts/browser_smoke.py` tests desktop/mobile filtering with isolated synthetic DOM entries only, making no customer/account/order writes.

## Security and data preservation
- Supabase RLS, Auth, multi-tenant mapping, Cashfree checkout, payment verification, settlement, delivery, owner/admin and order RPCs unchanged.
- Synthetic entries exist **only inside Chromium test DOM**, never in the live database or public product.
- No artificial ratings, offers, delivery estimates, history records or customer status changes.
- Manual authenticated order-history and actual iPhone/Android tests remain necessary prior to claiming full production acceptance.

## Verification and release
- Required: existing GitHub Actions Bite QA including Python frontend guards, Node tests, Chromium journeys and PostgreSQL regression; merge only on green CI.
- Ensure GitHub Pages deploy succeeds for the specific main SHA, then inspect real mobile screenshots and measure Core Web Vitals.
- No claim of Lighthouse score, WCAG audit certification, complete food-photo coverage or payment provider approval is made by this phase.

## Next phases
- Real-device and Lighthouse performance measurement, image asset size reductions based on data, menu/cart visual accessibility review, and payment/role/production readiness verification.
