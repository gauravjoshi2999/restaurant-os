# BITE — Launch Readiness Report
Date: 8 November 2026
Repository: https://github.com/gauravjoshi2999/restaurant-os
Customer storefront: https://gauravjoshi2999.github.io/restaurant-os/customer.html
Owner / Platform Admin: https://gauravjoshi2999.github.io/restaurant-os/

## Executive release decision

**Public preview: AVAILABLE. Production marketplace launch: BLOCKED.**

The static website is deployed on GitHub Pages and the public Customer storefront smoke tests have passed. Do not announce that customers can place real paid orders yet. Cashfree Payment Gateway remains In-Review; no approved marketplace payment credentials, split-settlement permission, signed webhook verification or sandbox reconciliation are active. Checkout intentionally fails closed and must not be bypassed.

## Work completed in this release pass

- Audited the live repository, deployment workflows, Supabase project, database advisors, live schema and key payment/delivery RPC definitions.
- Confirmed Owner primary navigation is restricted to Overview, Orders, Menu Management, Expenses, Reports and Settings.
- Found legacy POS, Tables, Purchases, Inventory, HR, Cashbook/Khata and Refund shortcuts still visible in the Owner overview launchpad even though route guards rejected those pages.
- Fixed the Owner launchpad so it only displays Orders, Menu Management, Expenses, Reports and Settings shortcuts; corrected Owner navigation labels to Orders and Menu Management. The Overview page remains the landing page.
- Preserved legacy database tables and historical data; no destructive data cleanup was performed.
- GitHub Pages deployment for the Owner launchpad fix succeeded: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42450724274
- Bite QA for that commit was still running at the time of this report: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42450724283

## Live infrastructure and data checks

- Supabase project `wedbgpybbgsszcmffoha`: ACTIVE_HEALTHY, PostgreSQL 17.
- Public schema: 40 tables; all 40 have RLS enabled.
- Live counts at audit time: 10 restaurants, 80 orders, 151 order items, 7 restaurant membership rows, 73 financial snapshot rows, 0 delivery handoff rows.
- Order split: 62 clearly flagged demo orders across 1–31 October 2026; 18 non-demo rows dated 6–7 November 2026. The latter are not certified as genuine customer transactions by this audit.
- Five approved, active, published demo restaurants are serviceable for PIN 313324. Demo order/expense/financial data must remain visibly marked as demo and must not be represented as genuine sales or settlements.
- Demo financial snapshots are unpaid and not settlement-ready. No live payment or payout was simulated.
- Checkout RPC validates restaurant approval, delivery/pickup eligibility, customer-owned saved address, PIN, zone, menu items and minimum order, then refuses to create an order while the payment provider is unconfigured.

## Automated test evidence

The latest completed pre-fix QA run passed static frontend checks and Chromium public customer smoke tests. The test covers:
- Customer storefront loads and fetches public approved restaurant listings.
- A restaurant menu opens without login.
- Checkout remains disabled and explains payment setup is pending.
- No cash-on-delivery option is exposed.
- Customer storefront has no horizontal overflow at 390px width.

This is not an authenticated full-stack acceptance test. The current QA script explicitly does not test signed-in Owner/Admin workflows, payment provider callbacks, delivery OTP completion or actual settlement.

## Security review — outstanding

Supabase Security Advisor currently reports:
- 5 anon-callable SECURITY DEFINER functions.
- 23 authenticated-callable SECURITY DEFINER functions.
- 20 multiple-permissive-policy warnings.
- 1 RLS-enabled table with no direct policies: `restaurant_delivery_handoffs`. This is intentionally RPC-only, with direct table access revoked; retain this pattern only after the token RPC review.
- 7 unindexed foreign-key findings and 38 unused-index informational findings.
- Leaked-password protection is disabled in Supabase Auth.

Reviewed selected critical RPC definitions: they use an empty fixed search_path and schema-qualified object references. Public delivery-area discovery checks approved/active/published status; handoff creation checks signed-in Owner role and Ready delivery order; delivery confirmation checks bearer token, expiry, Handed Over state and caps OTP attempts at five. These checks do not close the full per-function security review, IP/device rate limiting review or positive OTP journey.

Do not blanket-revoke SECURITY DEFINER functions or collapse RLS policies without checking every caller and rerunning tenant-isolation tests.

## Remaining launch blockers

1. Cashfree Payment Gateway approval and marketplace split-settlement permission.
2. Secure payment credentials stored only server-side; signed webhook verification; idempotency, failed/duplicate payment handling, refunds, provider fees and settlement reconciliation.
3. Enable Supabase Auth leaked-password protection in Dashboard → Authentication → Security, then re-check the advisor.
4. Resolve Owner membership conflicts through the Platform Admin. Two Owner accounts have multi-restaurant assignments; one restaurant has two distinct Owner memberships. No memberships were automatically reassigned.
5. Assign verified Owner accounts to restaurants that need them; three demo storefronts currently have no Owner login.
6. Use a dedicated Customer-only identity (not an Admin identity) for browser and negative RLS tests.
7. Run authenticated browser journeys: Customer login/address/cart → payment sandbox → Owner order accept/prepare/ready → delivery handoff link → customer OTP → completed order → Admin financial review.
8. Test cancellation, rejection, refunds, reporting/export and settlement workflows against sandbox data.
9. Complete per-function SECURITY DEFINER and RLS policy review; resolve warnings only with regression evidence.
10. Test Customer, Owner and Admin screens on Android mobile and desktop using the actual account roles.

## Correct URLs for sharing

- Share the Customer storefront with diners: https://gauravjoshi2999.github.io/restaurant-os/customer.html
- Use the root URL for Owner / Platform Admin sign-in: https://gauravjoshi2999.github.io/restaurant-os/

The root URL is currently the Owner/Admin app, not the Customer storefront. Use the customer.html URL as the website address in payment-provider onboarding and customer marketing unless the routing/domain is intentionally changed.

## Final status

- GitHub Pages deployment: PASS.
- Customer public smoke checks: PASS on latest completed QA run; post-fix QA was pending when this report was written.
- Owner menu scope and launchpad cleanup: code updated and Pages deployment succeeded; post-fix automated QA pending.
- Supabase RLS enabled across public tables: PASS.
- PIN 313324 demo discovery coverage: PASS.
- Real payment checkout / marketplace settlement: BLOCKED.
- Authenticated Owner/Admin browser E2E: NOT PASSED.
- Positive delivery OTP E2E: NOT PASSED.
- Production security acceptance: NOT PASSED.

**Recommendation:** Keep BITE available as a public preview/pilot demonstration only. Do not advertise real ordering or accept customer money until the payment, Auth, Owner mapping and end-to-end release gates above are closed.


## Owner workspace follow-up — 8 November 2026

Latest implementation commits:
- `b3009cca73012be72e6d1a6b109943e85c8d8472`: remove inactive aggregator order-channel cards and replace the Owner order workspace copy.
- `c20da2c21104586006a394ed03eaaba9fa2136ee`: scope Owner order board, inbox, dashboard metrics and outlet title to the selected restaurant membership.
- `62b99ca57b1faf201178554ff50b18a51447b28d`: replace generic Project Setup / demo reset panel with an actual Owner restaurant profile and order-preferences form.
- `f31e253a82f1a73835eeba120c02fec892688252`: finish Owner dashboard date label and order-summary source label.

### UI changes
- Removed the confusing cloud notice that listed inactive Zomato/Swiggy and automatic settlement integrations.
- Removed Zomato, Swiggy and POS channel cards from the Phase 1 Orders screen; it now presents BITE Website orders only.
- Removed the Owner-facing legacy launcher. The Owner workspace retains the six approved navigation sections: Overview, Orders, Menu Management, Expenses, Reports and Settings.
- Reworked Owner Overview polish: outlet hero, daily metrics, recent BITE orders, quick actions and mobile spacing.
- Replaced the Owner Settings' generic project setup / reset-demo controls with a restaurant profile and order-preferences form. The form writes only ordinary restaurant profile fields via the signed-in Owner's RLS-protected update permission; it does not expose approval, publication, reviewer or commission fields.
- Scoped Owner order board, new-order inbox, channel counts and dashboard order metrics to `access.restaurantId`, so a multi-membership login is not silently shown another outlet's orders while a selected outlet is active.

### Verification
- GitHub Pages deployment for commit `62b99ca57b1faf201178554ff50b18a51447b28d` completed successfully: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42451233960
- Bite QA for that commit completed successfully, including inline/static frontend checks and Chromium Customer storefront smoke tests: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42451234017
- Final small date/source-label polish commit `f31e253a82f1a73835eeba120c02fec892688252` triggered a fresh QA run and Pages deployment; these final runs were still in progress when this report update was prepared: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42451280082 and https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42451280041

**Limit of this follow-up:** the automated browser suite still tests the public Customer storefront, not a signed-in Owner session. The Owner profile save form, selected-restaurant isolation in a real browser, and each of the six Owner sections still require authenticated role-based browser acceptance testing. These changes do not activate Zomato/Swiggy APIs or automatic settlement, and do not change the production payment blocker.


## Additional hardening and database verification — 8 November 2026

Execution record: [docs/EXECUTION_LOG_20261108.md](EXECUTION_LOG_20261108.md)

Changes now applied after the previous report:
- Owner online-order KPI corrected; Owner and Super Admin live sales metrics now use only paid, non-demo BITE financial snapshots, and demo rows do not inflate live-order counts.
- The 62 October 1–31 `Bite Demo Simulation` orders for Demo Royal Thali House are now included in the BITE website order board with a visible `DEMO ONLY` label. They remain excluded from live metrics and settlement totals.
- Owner new-order realtime alerts are restricted to BITE website orders.
- Customer forgot-password flow now sends a Supabase Auth reset email, handles the recovery session, confirms the new password and updates it without requiring email re-entry after the reset link returns.
- Checkout financial snapshot now uses the restaurant commission override or configured platform default (10%), rather than the legacy 18% literal.
- Duplicate Owner assignments are blocked by the Owner login guard, both Owner provisioning Edge Functions, and a database trigger with a transaction-scoped advisory lock. Platform Admin accounts cannot be newly assigned as Owners.
- Supabase Owner and invite Edge Functions deployed as versions 7 and 4 respectively.

Live SQL verification:
- 40/40 public tables have RLS enabled.
- Owner profile update succeeds; Owner commission-rate modification is rejected.
- Duplicate Owner assignment and Platform Admin-as-Owner inserts are rejected.
- A valid checkout attempt is rejected before order creation while the payment provider is unconfigured.
- Delivery handoff positive path passed through customer-only OTP retrieval, bearer-link lookup, Owner handover and successful OTP completion.
- Five incorrect OTP attempts are counted; the sixth attempt is blocked.
- All SQL workflow tests were run in transactions and rolled back; no QA order or handoff rows remain.

Source-level verification:
- Inline JavaScript in Customer, Owner/Admin and Delivery pages parses successfully.
- Static assertions pass for password recovery, Owner mapping guards, dashboard sales calculations, demo labelling, BITE-only alerts and client-side secret-key absence.
- Chromium smoke coverage now includes Customer forgot-password entry and the mobile Owner/Admin sign-in gate. This is additional test coverage, not evidence that the latest GitHub Actions browser run has passed.

**Production acceptance remains withheld.** Cashfree merchant review and marketplace split-settlement approval are external prerequisites; no real paid checkout, refund or bank settlement has been enabled. Existing Owner mapping conflicts were not reassigned or deleted without verified identity mapping. Supabase Auth leaked-password protection remains disabled in Security Advisor. Authenticated Owner/Admin browser acceptance and the reset-email delivery round-trip have not yet been verified.


## Follow-up security verification — 8 November 2026

- Revoked anonymous EXECUTE on the two SECURITY DEFINER helper RPCs `check_restaurant_delivery_area(uuid,text)` and `is_restaurant_public(uuid)` after confirming neither is called by the current public frontend.
- Kept the three required public endpoints available: `list_public_restaurants()`, `get_delivery_handoff(text)`, and `confirm_delivery_handoff(text,text)`.
- Verified privileges live: the two unused helpers deny anon execution; the three required public endpoints remain anon-callable.
- Security Advisor anonymous SECURITY DEFINER warnings decreased from 5 to 3. Authenticated SECURITY DEFINER warnings remain 23 and require per-function review; no blanket revocation was applied.
- All 40 public tables continue to have RLS enabled.
- Latest deployment run 42451337908 and QA run 42451337932 completed successfully. The QA browser job tests public Customer flows only; Owner/Admin authenticated E2E is not certified by that run.
