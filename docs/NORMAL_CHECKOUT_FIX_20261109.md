# Normal customer checkout — 9 November 2026

The normal storefront had a hardcoded disabled payment button. Only the `live_checkout_test=1` URL enabled the already deployed, server-gated Cashfree checkout. This explains the user's screenshot showing “Online payment setup pending” even after an earlier paid order had completed delivery.

## Repair

- Normal checkout now calls an authenticated, read-only readiness action before profile/address writes or payment preparation. The existing backend enabled flag and configured provider keys remain mandatory. JWT verification and customer ownership checks remain enabled. The readiness response contains only readiness, provider and environment.
- The old test URL flag no longer gates the normal production flow. The normal flow creates a server-priced checkout intent, opens Cashfree production checkout, and relies on the existing server verification/activation endpoint before showing an order. There is no unpaid-order fallback or COD route. Explicit sandbox URLs retain separate drafts, endpoints and labels.
- Repeated clicks are ignored while work is in progress. In-page retries retain the checkout intent and provider session. An uncertain verification retries the status before allowing payment continuation. Pending checkout fields stay locked; reopening checkout retains that payment's details.
- The button shows Pay online, Continue payment, Check payment status or Online payment unavailable according to actual state. The static safety-verification message has been removed.

## Evidence and limits

- Read-only inspection found the production session endpoint enabled. The existing database contained one activated, paid, non-demo checkout whose restaurant order was Completed. No new payment, real order, customer profile or address was created for this repair.
- Eleven added behavior cases exercise readiness success/denial, no writes when unavailable, delivery-area denial, production versus sandbox routing, trusted verification, SDK-only success rejection, uncertain verification retry, cancelled checkout resumption, rapid repeated clicks, and backend auth/configuration gates. These use isolated mocks and do not charge money.
- Existing frontend/Owner checks and the combined 23 behavior cases pass. Chromium CI retains public discovery/cart/auth and mobile form coverage. The browser check now expects a readiness lock before authentication instead of assuming payment configuration is permanently pending.
- This repair does not claim a new authenticated paid E2E transaction. Full payment continuity after closing/reloading the page, provider webhooks and abandoned-checkout reconciliation remain separate from the in-page retry protection added here.
