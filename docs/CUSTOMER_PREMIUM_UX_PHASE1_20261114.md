# Bite premium customer UX — phase 1 (14 November 2026)

## Scope and evidence
Reviewed customer.html, assets/customer-storefront.css, assets/bite-theme.css, assets/customer-discovery.js, assets/customer-completion.js, README.md, docs/PRODUCT_BLUEPRINT.md and docs/UI_REFRESH_20261109.md.

The current customer site already implements Supabase-backed discovery, PIN serviceability, menus, filtering, cart quantities and order journeys. It should not be rebuilt from zero.

## Code-level audit findings

- Existing mobile CSS reduces important header, card, offer and metadata labels to roughly 6–10px at narrow viewports.
- Overlapping storefront/theme styles have inconsistent food-red/orange and neutral tokens; shared components require visual alignment.
- The PIN is changeable in the results section, but the header has no prominent saved-address bottom sheet.
- Search already works but has no nearby inline restaurant/dish suggestions.
- Cart/payment, delivery handoff, owner/admin and customer identity are stateful and sensitive; avoid risky changes without focused end-to-end QA.
- Owner-supplied, menu-supplied and Bite-suggested photos must remain distinguished; no fake ratings or offers.

## This review branch delivers

1. Customer-only premium green/cream design layer with improved typography, responsive restaurant cards, stronger CTA hierarchy, touch targets and reduced-motion support.
2. A keyboard-accessible delivery PIN / saved-address picker connected to the existing form. Logged-out users may type a PIN; logged-in users see only their RLS-scoped saved addresses.
3. Search suggestions from already fetched public Supabase data; visibility respects delivery PIN, service type and diet filter.
4. Clearer mobile bottom navigation, floating cart, menus and layout, preserving the founder-selected Bite logo.
5. No database migrations and no modifications to payment, pricing, auth, order, delivery, owner or admin processing.

## Tests and verification limits

- The new script is covered by scripts/customer_premium_ux.test.cjs and is part of the existing scripts/*.test.cjs CI run.
- Run the existing Python frontend checks and Playwright/Chromium smoke tests in the Bite QA workflow.
- Test 320, 360, 390, 768, 1280 CSS pixel widths, plus a physical Android and iPhone when available.
- Manually verify authenticated/unauthenticated saved addresses, denied geolocation, PIN coverage, search suggestions and keyboard navigation.
- Repeat menu quantities, cart persistence, order history, modal close and existing payment gating regressions.
- Performance and accessibility goals remain targets, not measured results: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1, Lighthouse mobile >= 90, WCAG 2.2 AA.
- No real payment, refund, settlement or production authentication was executed as part of this styling change.

## Follow-on phases

1. Refine restaurant-menu content hierarchy and interaction states with authenticated real-device tests.
2. Refine cart, coupon and checkout copy only after confirming server-authoritative pricing/payment controls.
3. Image optimization, measured performance/accessibility work and product QA for all role boundaries.
4. Production release only after the established approved checkout, RLS and payment-verification gate passes.

Production is deliberately unchanged on this feature branch until reviewed and merged.

## Phase 2 — restaurant menu and cart enhancements (14 November 2026)

- Enhanced hierarchy and accessibility of existing restaurant menu cards, category filters and search without rebuilding data flows.
- Added **Add something else?** carousel in the existing cart modal. Items come only from the currently selected restaurant's loaded, available menu rows; there are no fabricated ratings, offers or popularity rankings.
- Each add-on button uses the exact same local cart mutation, menu quantity refresh, cart rendering and restaurant-scoped persistence as ordinary menu buttons.
- Existing pending-payment guard prevents add-on changes while a previous payment needs verification.
- Added new Node source guards in `scripts/customer_menu_cart_premium.test.cjs` and a real Chromium click-through assertion in `scripts/browser_smoke.py`.
- No backend changes, owner/admin modifications or unverified checkout/payment changes.
- Mobile screenshots, performance measurements and authenticated production checkout are **not** certified by these commits.
