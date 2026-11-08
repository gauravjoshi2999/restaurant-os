# Master Prompt Implementation Audit — 2026-11-07

This audit is subordinate to `docs/PRODUCT_BLUEPRINT.md`, which now mirrors the user's 2026-11-07 Complete Master Prompt. It supersedes the old 120-question interview.

## Verified repository/runtime

- GitHub repository: `gauravjoshi2999/restaurant-os`, default branch `main`.
- Current frontend is two large standalone HTML applications: `customer.html` and `index.html`; `delivery.html` is the public delivery handoff page.
- Hosting is GitHub Pages (static hosting). Supabase is the backend: Auth + PostgreSQL 17 + RLS.
- Supabase project `restaurant-os`, ref `wedbgpybbgsszcmffoha`, status ACTIVE_HEALTHY, PostgreSQL 17.11.
- Live schema inspection found 39 public tables; all listed tables currently have RLS enabled.
- Sample live row counts include 10 restaurants, 18 orders, 27 order items, 40 menu items, 2 customer addresses, 2 customer contact profiles, 2 expenses and 1 review. Treat sample/demo rows as test data unless independently verified; do not present them as genuine marketplace activity.
- Existing delivery-handoff and customer request/review SQL objects are present in the live schema.
- No live marketplace payment provider credentials or verified merchant onboarding were found in the repository audit.

## Scope conflicts to remove from active product

Current owner navigation and database include older POS & Billing, Tables/dine-in, Customer Khata, Cashbook/closing, Purchases & Suppliers, Inventory/Stock, Employees & HR, plus old reconciliation/financial modules. These conflict with the new initial-release exclusions unless explicitly mapped to the new simple daily expenses/accounts and Admin payment reconciliation requirements.

The new initial release excludes POS/counter sales, dine-in, KOT/KDS, inventory/stock, supplier/purchase workflows, HR/payroll, customer khata, cashbook/closing, multiple branches, Zomato/Swiggy workflows, hotel modules, delivery fleet and subscriptions.

**Data safety:** Existing tables and rows must not be dropped as a shortcut. Remove/deactivate conflicting UI and code paths in a controlled refactor; retain legacy schema/data until dependency mapping, backup and an explicit migration plan are complete. New features must use only the approved model.

## Master Prompt requirements not yet verified as production-complete

- Customer discovery/address coverage filters and complete mobile/email auth/profile.
- Fully functional menu/cart/coupon/saved cart and one-restaurant checkout.
- Real payment aggregator, signed webhook verification, split settlement, provider fees, refunds and reconciliation.
- 5-minute owner acceptance timeout with server-side cancellation/refund workflow.
- Full owner workflow and order timeline.
- Delivery link token security, OTP privacy/attempt limiting, OTP handoff and support escalation.
- Restaurant onboarding documents, Admin approval and bank/profile change approval.
- Customer support tickets and Admin support queue.
- Simple date-separated income/expense accounts and accurate PDF/Excel reports.
- Reviews/report moderation and notifications/push.
- Full Admin restaurant/customer/order/payment/commission/audit management.
- Full browser-based role and tenant-isolation tests on mobile and desktop.

## Security advisor findings at audit time

Supabase security advisor reported:
1. `restaurant_delivery_handoffs` has RLS enabled but no direct policies. Verify that it is intentionally accessible only through narrowly scoped, reviewed RPCs.
2. Five public SECURITY DEFINER functions callable by anon, including public restaurant discovery and delivery-token endpoints. Review each function's authorization, token entropy/hash, expiry, rate limits and grants.
3. Twenty-four SECURITY DEFINER functions callable by authenticated users. Review every function for explicit auth.uid ownership/tenant checks and least-privilege grants; do not blindly revoke required RPCs without tracing callers.
4. Leaked-password protection is disabled in Supabase Auth; enable before production.
5. SECURITY DEFINER functions must use a fixed safe search_path and explicit authorization checks. Never rely on user-editable user_metadata for roles.

## Payment provider research (not a provider selection or approval)

Two documented Indian marketplace candidates to evaluate with provider sales/compliance before implementation:
- Cashfree Easy Split documents vendor onboarding, split orders, vendor settlements, refunds, reconciliation and settlement APIs: https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview
- Razorpay Route documents linked accounts, split transfers, refunds/reversals and reconciliation: https://tfs.np.razorpay.in/docs/payments/route

The platform must obtain written confirmation of eligibility, KYC/document requirements, permitted food marketplace use case, fee schedule, split timing, refund/reversal behavior and settlement cycle. Do not promise next-day settlement or choose a provider solely from public docs. No live payment code should be enabled before the Bite merchant account is approved.


## Phase 1 progress — 2026-11-08

### Implemented and applied to live Supabase

- Added `onboarding_status` (`pending|approved|rejected|suspended`), submission/review timestamps, reviewer ID and rejection reason to `restaurants`.
- Existing records were preserved. Rows already both Active and published were classified as approved; remaining rows were left pending. Live counts after migration: 5 approved, 5 pending.
- Added a database trigger that blocks non-admin users from changing approval status, reviewer metadata, publication flag or restaurant status. This enforces approval at the database layer, not merely through UI hiding.
- Updated `is_restaurant_public(uuid)` to require `onboarding_status='approved'` in addition to active and published.
- Removed default PUBLIC execution from that discovery helper; explicit anon/authenticated/service_role grants remain.
- Live test: using a non-admin restaurant owner JWT context, attempted to change the restaurant onboarding state; database rejected it with SQLSTATE 42501. The test transaction rolled back; no test data was changed.
- Migration files: `supabase/20261108083000_bite_phase1_restaurant_onboarding_guard.sql` and `supabase/20261108083500_bite_phase1_public_function_grants.sql`.


### Additional Phase 1 work — configurable commission and approval enforcement

- Added `platform_settings` with a database-enforced default commission of 10.00%. Only Platform Admins can read or update this settings row through authenticated access.
- Added optional per-restaurant `platform_commission_rate` override (nullable; null inherits the global default). A database trigger prevents owners/managers from changing this field; the attempted owner update was rejected with SQLSTATE 42501.
- Updated `create_order_financial_snapshot` to read the restaurant override or global default rather than hardcoding the old 18% rate. The function is no longer executable by anon.
- Updated public restaurant discovery and the customer checkout eligibility check to require `onboarding_status='approved'`. Live check: 5 restaurants listed and 5 restaurants both approved, active and published.
- Checkout still explicitly refuses to create an order until an approved marketplace payment provider is configured; no fake payment/order success was introduced.
- Migration files: `supabase/20261108090000_bite_phase1_configurable_commission.sql` and `supabase/20261108091000_bite_phase1_enforce_approved_restaurant_discovery.sql`.

### Still open in Phase 1

- Auth leaked-password protection remains disabled; the current connected tooling does not expose the Auth security setting. Enable it in Supabase Dashboard → Authentication → Security and confirm it before production.
- Security advisor still flags 5 anon-callable and 24 authenticated-callable SECURITY DEFINER functions. Some are intentional public discovery/delivery token RPCs, but each must be reviewed for authorization, rate limiting, token entropy/hash and least-privilege grants before release.
- `restaurant_delivery_handoffs` has RLS enabled but no direct policies; access appears intended through RPCs. Verify all grants and RPC paths before accepting production traffic.
- Live membership audit found at least two owner accounts each linked to two restaurants, which conflicts with the one-owner-account/one-restaurant requirement. One restaurant also has two distinct owner accounts. Do not auto-remove or reassign memberships; resolve the exact intended owner-to-restaurant mapping before adding constraints or changing access. No membership was deleted or reassigned.
- The current dashboard still exposes legacy modules (POS, tables, khata, cashbook, purchases, inventory, HR). They are not removed from the database; UI refactor is pending.
- The owner dashboard currently calculates access role from all memberships and selects the first owner restaurant; a single-restaurant-per-owner enforcement and UI cleanup are still pending.
- No full browser end-to-end suite has been run yet. A successful migration is not proof that all three role journeys work.

## Recommended implementation order

1. Freeze this Master Prompt as source of truth (done in docs).
2. Map existing frontend navigation, page handlers, RPCs, RLS policies and schema dependencies against the new scope.
3. Design a forward-only target schema and migration plan; backup/retain old rows.
4. Refactor owner/admin navigation and role boundaries to only the three panels and approved features.
5. Complete customer discovery, profile, menu, cart and checkout.
6. Integrate approved marketplace provider in test mode via trusted Edge Functions/webhooks.
7. Implement owner acceptance timeout, status lifecycle, delivery link and OTP.
8. Implement Admin onboarding/approval, support, payments, commissions and audit.
9. Implement simple daily expenses/accounts, date-separated reports, invoices and exports.
10. Run automated DB/RLS/RPC tests, browser E2E for each role, payment sandbox tests, Android/desktop responsive tests and production security review.

## Release rule

A GitHub Pages deploy or JavaScript syntax check is not acceptance. A phase is complete only after real Supabase-backed behavior, role/tenant isolation, negative authorization tests and the end-to-end browser path have passed.

### Owner workspace MVP cleanup

- Updated the Owner login context to require exactly one restaurant membership and exactly one owner membership. Accounts linked to multiple restaurants are blocked with a clear admin-resolution message instead of silently selecting the first restaurant.
- Manager/staff logins are not enabled in the initial Master Prompt version; those legacy memberships are not silently granted Owner access.
- Owner navigation now exposes only Overview, Orders, Menu, Expenses, Reports and Settings. POS, table management, khata, cashbook, purchases, inventory, HR, and other excluded legacy modules are hidden from the Owner workspace. Their historical database tables and records are preserved.
- Admin navigation remains limited to platform Overview, Restaurants, Orders and Financials.
- GitHub Pages deployment workflow was triggered by the source update; awaiting its final result.
