# Bite Customer UX — Faster Menu Search and Useful Cart Discovery
Date: 2026-11-14

## Audit findings
- Restaurant menus already load from Supabase with `is_available=true`; the existing search recomputed Unicode normalization for every item on every keystroke and searched names/descriptions without ranking.
- The prior cart's "Add something else?" section selected the first six available unselected items, with no awareness of existing cart categories or vegetarian selection.
- Order totals, delivery fees, coupon eligibility and payments are verified in existing checkout flows. None of those systems should be changed for this work.

## Implemented
1. **Search index**: Pure `assets/customer-menu-search.js` memoises normalized menu names/descriptions per loaded menu array using WeakMap. It keeps existing Hindi and English token matching, filtering, and restaurant menu ordering for empty queries.
2. **More useful results**: For an entered query, exact dish-name and name-prefix matches appear before description-only results. No fake popularity, AI certainty, ratings, reviews or offers are introduced.
3. **Responsive typing**: The existing 120ms search debounce is reduced to 70ms. No measured latency or Core Web Vitals claims are made.
4. **Cart discovery**: The "Add something else?" row uses only real loaded menu data, excludes unavailable and already-added items, respects the existing quantity controls, prefers different menu categories when possible, and prioritizes vegetarian suggestions for all-vegetarian carts. Non-vegetarian dishes are never represented as vegetarian.
5. **Safety**: No new API requests, customer tracking, menu-price changes, restaurant mapping, saved-address queries, Cashfree changes, or Supabase/RLS modifications.

## Verification
- `scripts/customer_menu_search_relevance.test.cjs` covers multilingual matching, empty-query ordering, name-first ranking, vegetarian preference, category variety, 0-price items, unavailable items, and backend boundaries.
- Existing `scripts/customer_menu_cart_premium.test.cjs` reflects the new helper while continuing to protect customer cart and payment boundaries.
- `scripts/browser_completion.py` adds an **isolated synthetic in-memory customer fixture** for fast search sorting, cart add-ons and actual cart quantity changes. The fixture resets before ordinary account/order tests and never makes production payments or mutations.
- Require green GitHub Actions PR QA, merged-main QA and exact-commit GitHub Pages deployment before claiming live.
- Still needed: real logged-in Android/iOS visual review, measured Lighthouse/Core Web Vitals and production payment readiness checks.
