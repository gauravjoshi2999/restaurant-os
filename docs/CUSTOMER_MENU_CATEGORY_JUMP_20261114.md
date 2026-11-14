# Bite Customer Menu Navigation — Category Jump
Date: 2026-11-14

## Audit
The existing restaurant menu uses actual Supabase `menu_categories` and `menu_items`, renders category chips and filters item cards when a chip is selected. The chip rail was centered horizontally but the page did not scroll to the filtered dishes. On mobile the customer could remain above the new results. Search, Veg only, cart quantity, and saved cart already worked.

## Implemented
- Selecting any category now filters from the existing loaded menu, then reveals that category's dish results below the sticky customer header and sticky category-chip rail. The function uses live element geometry and viewport scroll; it has no database or payment dependency.
- If reduced motion is enabled, the result scroll uses automatic movement rather than animation.
- Selected category name displays as a heading above results. The existing live result count remains the source of truth; no fabricated dish counts or descriptions.
- Category chips expose `aria-controls="menuItems"`, `aria-pressed` and a labelled group, with touch targets >=44px, visible keyboard focus and overflow-safe mobile styling.
- Empty categories still show the original no-results recovery; the tab does not create or reorder any restaurant items.

## Verification
- `scripts/customer_menu_category_jump.test.cjs`: executable scroll geometry, hidden-screen protection, reduced motion, original menu/cart behavior and script parsing.
- `scripts/browser_completion.py`: isolated synthetic mobile fixture inserts one synthetic Breakfast dish, clicks the category, verifies filtered dish, visible heading, scroll position and selection, then removes the synthetic dish. Nothing is uploaded to Supabase.
- Existing all-role and PostgreSQL regression checks still required.
- Real logged-in iPhone/Android verification remains separate; no claim of paid checkout readiness or Core Web Vitals improvements.

## Safety
No changes to Supabase schema, Auth, RLS, restaurant availability, image provenance, cart/pricing, checkout, Cashfree, delivery OTP, or Owner/Admin dashboards. GitHub Pages deploy should only follow successful PR and main branch QA.
