# Bite Owner and Customer refresh — 9 November 2026

## Implemented

- Twelve Owner sections remain. Daily work, accounts and business have separate navigation groups. Inactive POS/refund links and duplicate homepage shortcuts were removed from active navigation; historical records remain intact.
- Replaced two obsolete Owner dashboard themes with the shared Owner stylesheet and a task-oriented homepage. Live order queues include unfinished website orders from earlier dates. Recent activity excludes demo and legacy POS orders.
- Homepage collections and the seven-day chart use actual financial snapshots, adjust confirmed refunds and exclude samples. Current business expenses use India dates and exclude demo/foreign-restaurant entries. Expense page reloads update the same expense state as the homepage.
- Customer discovery, restaurant cards, menu, cart and account surfaces use a consistent Bite theme. Food category and illustrative cover photos are served from the repository. Restaurant-supplied dish photos remain separate.
- Restaurant and dish search, category/service filters, reset/empty/retry states, explicit fastest-preparation sorting, menu category/search/vegetarian combinations and direct add/remove quantity controls are connected to existing backend data and the saved cart.
- Existing payment, delivery-zone, account, OTP, legal/contact and Admin guards are retained, including the current Cashfree SDK, server-verified return handling, gated live-test/sandbox checkout, saved-address PIN sync, verified-order inbox and token-before-handover sequence. No database records or schema were deleted or migrated for this refresh.

## Observed verification

- All twelve Owner routes opened in an authenticated Demo Royal Thali House Owner session, with visible page headings, no horizontal overflow and no workspace error. This check occurred before the workspace/browser restart; a later Owner mobile sign-in attempt returned the application's valid-mobile/email validation error, so final authenticated Owner mobile verification was not completed.
- Customer desktop search returned three restaurants for paneer; an unmatched search showed a working reset action. Pizza category returned the Pizza restaurant. Fastest-preparation sorting produced 20, 20, 25, 30 and 35 minute entries.
- Restaurant menu search for paneer plus Veg only returned two actual dishes. Adding Paneer Butter Masala twice produced 438; removing one produced 219. The cart detail showed the matching dish and amount.
- Customer responsive Chromium testing at 340 CSS pixels showed zero horizontal overflow, all category images loaded, menu access, direct item addition and a working floating-cart opener. This is narrow-viewport testing with browser zoom, not physical Android-device certification.
- At desktop width, returning to restaurant discovery hides the floating menu cart. The very short viewport used by the zoom check made one back-button click inconclusive; actual Android-sized public smoke coverage is included in the CI script.
- Existing structural/static checks and twelve Node behavioral cases passed locally. CI additionally exercises actual public Chromium discovery, menu filters, quantity/cart changes, authentication entrypoints and a 390-by-844 mobile viewport.

## Verification boundary

No real purchase, payment, refund, settlement, message or business-data deletion was performed in this refresh. Existing production payment configuration and broader security work are covered separately. The older temporary browser QA records documented in OWNER_VERIFICATION_20261109.md were not altered by this change.
