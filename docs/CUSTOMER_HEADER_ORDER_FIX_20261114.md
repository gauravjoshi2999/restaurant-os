# Bite — Customer Header & Order Card Cleanup (2026-11-14)

## User-reported issues
Screenshots on narrow mobile devices showed the selected PIN in the header *and* in a large results-area form; an always-visible English/हिन्दी toggle between header and search; the selected multicolour Bite logo clashing with the green customer theme; and a loose "Delivery" text node between My Orders action buttons.

## Implemented
1. **Single PIN location UI** — Keep the interactive header `#biteLocationOpen` and its accessible location/address bottom sheet. Hide the redundant `#discoveryLocationForm` from the page but retain its form ID, inputs and submit handler so current PIN serviceability and saved-address workflows stay intact. Remove the redundant "Delivery PIN 313324" copy from the header status announcements.
2. **Remove customer-only language toggle** — Unload `assets/bite-language.js` from `customer.html`; this eliminates its actual injected button row and translation observer rather than leaving an inert hidden strip. Leave Owner/Admin assets unchanged. The customer page's main language is English with Hinglish explanatory copy.
3. **Original theme-matching brand** — New forest-green serving-bowl icon `assets/bite-premium-mark.svg`, typography-only Bite wordmark and Eat. Repeat. tagline in header and footer. Icon selected as SVG favicon. Original Owner, QR and existing selected-logo files untouched.
4. **Correct fulfilment hierarchy** — Render `Delivery` or `Pickup` as a badge adjacent to order status and **outside** `.orderactions`. Unknown mode labels explicitly say "Method unavailable" instead of inventing delivery. Keep Order again, Download bill, View details, cancellation/review/complaint buttons and real order data unchanged.
5. **Mobile polish** — Compact, single-row header designed for 320px+ widths; smaller aligned brand, clear PIN dropdown and usable Logout button. Mobile-friendly status and fulfilment badges.

## Verification
- `scripts/customer_header_order_cleanup.test.cjs` verifies source-level invariants, customer-only scope, the PIN form preserved-but-hidden, no language script injection and the badge placement in the actual order renderer.
- `scripts/browser_smoke.py` asserts real brand image loading and no duplicate visible PIN card or language row at desktop and mobile widths.
- Existing Bite QA must still pass Python frontend validation, Node tests, Chromium public discovery/menu/cart/browser tests and PostgreSQL regression.
- Manual authenticated My Orders screenshots are required to certify actual logged-in order-card presentation. CI's browser smoke test uses public unauthenticated pages, so do not describe it as authenticated testing.
- No changes to payment, pricing, Supabase RLS, auth, delivery OTP, Owner or Admin data access. No production payment performed by this patch.

## Release notes
Merge only with successful GitHub QA; verify the exact GitHub Pages deployment SHA. The design adjustment does not mean the marketplace is approved for production payments.
