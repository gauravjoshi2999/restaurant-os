# Bite Phase 1 QA Follow-up — 8 November 2026

## Latest CI and deployment
- Commit: `7c3dd5b1f76782430a6876719d3bd588e8d0fee6`
- Bite QA run: SUCCESS — https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42445359090
  - Inline JavaScript / critical frontend guards: SUCCESS
  - Chromium public customer storefront smoke tests: SUCCESS
- GitHub Pages deployment: SUCCESS — https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42445359083
  - Inline JavaScript validation, Pages upload and deploy: SUCCESS

## Live Supabase revalidation
Project: `wedbgpybbgsszcmffoha`

### Demo data integrity
- Demo orders: 62 across 31 distinct calendar dates, 1–31 October 2026.
- Demo order items: 124.
- Demo order status events: 314.
- Demo financial snapshots: 62; all remain unpaid and not settlement-ready.
- Demo expenses: 31.
- Demo commission snapshots: 10.00% throughout.
- No live payment or settlement was simulated.

### Customer discovery and delivery coverage
- Approved, active, published restaurants: 5.
- Each published demo restaurant has 2 menu categories and 8 menu items.
- PIN 313324 is serviceable for all 5 published demo restaurants.
- Configured delivery fee / minimum order:
  - Demo Royal Thali House: ₹25 / ₹149
  - Demo Pizza Junction: ₹35 / ₹199
  - Demo South Street: ₹20 / ₹99
  - Demo Spice & Curry: ₹30 / ₹179
  - Demo Sweet & Snacks: ₹20 / ₹79
- The customer order RPC checks the restaurant, delivery/pickup eligibility, customer-owned saved address, six-digit PIN, delivery zone, menu items and minimum order. It raises the payment-provider-not-configured exception before inserting the order. Checkout remains deliberately fail-closed.

### Delivery handoff security review
- `restaurant_delivery_handoffs` has RLS enabled and no direct table policies; direct `anon` / `authenticated` table access is revoked. This is intentional RPC-only access, not an omitted public table policy.
- Owner-only handoff creation checks restaurant role, Ready status, delivery type, customer identity and address snapshot.
- Public handoff lookup uses a 256-bit random bearer token stored as a SHA-256 hash, with active / expiry / order-status checks.
- OTP confirmation requires Handed Over status, limits each token to 5 attempts, deactivates the token on success and moves the order to Completed.
- The delivery handoff table currently has no live handoff rows, so the positive customer OTP journey still needs a dedicated real customer-owned delivery order in a sandbox environment.
- SECURITY DEFINER warnings remain for intentional public discovery and capability-link RPCs, plus authenticated business workflows. They must not be blanket-revoked. Per-function authorization and least-privilege review remains a production task.

### Remaining live account / release blockers
1. Cashfree Payment Gateway is still In-Review. No production payment credentials, split-settlement approval or verified webhook flow is active. Do not enable real checkout until approval and sandbox reconciliation tests pass.
2. Two Owner accounts are linked to multiple restaurants; `Gg Restaurant` has two distinct Owner memberships. Do not auto-reassign accounts. A Platform Admin must confirm the correct owner-to-restaurant mapping.
3. Three demo listings currently have no Owner membership; they are public demo storefronts only and cannot be used for an Owner-login E2E test.
4. A dedicated Customer-only test identity is still required for customer-vs-customer negative RLS tests and a real address-book browser cycle.
5. A real Owner and Platform Admin browser walkthrough is still required. Current Chromium CI smoke tests cover the public customer storefront, responsive width, restaurant menu access and the payment fail-closed state; they do not certify authenticated Owner/Admin workflows.
6. Supabase Auth leaked-password protection remains disabled and must be enabled in Supabase Dashboard → Authentication → Security before production.
7. Supabase Security Advisor still reports callable SECURITY DEFINER functions and multiple permissive policy warnings. These require per-function/policy review with regression tests; no blanket permission changes were made.
8. Full production acceptance remains NOT PASSED until Cashfree approval, the account mapping decisions, the Auth security setting and all authenticated role journeys are completed.

## Release decision
**Phase 1 code deployment and public customer smoke CI: PASS.**
**Database demo integrity / PIN 313324 coverage / payment fail-closed checks: PASS.**
**Authenticated Owner/Admin + real payment + customer delivery OTP E2E: NOT YET PASSED.**


## Additional role-isolation regression — rollback-only SQL
- Dedicated Customer-only identity (not a Platform Admin and not a restaurant member): sees 1 own saved address and 0 foreign saved addresses; sees 0 own orders and 0 foreign orders in this test sample; an attempted no-op UPDATE against another customer's address affected 0 rows. Transaction rolled back.
- Single-restaurant Owner identity for Demo Royal Thali House: sees 71 own orders and 0 Demo Pizza Junction orders; a no-op UPDATE against the foreign restaurant's menu affected 0 rows. Transaction rolled back.
- Platform Admin identity: `is_platform_admin()=true`, sees 10 restaurants and 80 orders. Transaction rolled back.
- These SQL checks confirm the tested Customer, Owner and Admin database scopes. They do not replace the pending authenticated browser walkthroughs.
