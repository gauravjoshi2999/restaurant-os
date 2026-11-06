# RestaurantOS — Phase 0 Repository Audit

**Audit date:** 2026-11-06  
**Scope:** Repository and migration-file inspection only. No live Supabase schema or customer data was queried.

## Repository facts verified

- Repository: `gauravjoshi2999/restaurant-os`
- Default branch: `main`; linked GitHub permissions include push/admin.
- Deployment: GitHub Pages workflow runs on pushes to `main` and uploads the repository root as a static site.
- Frontend: two large standalone pages, `index.html` (owner/admin workspace) and `customer.html` (customer storefront), using Supabase JS v2 from a CDN.
- Backend: Supabase Auth + PostgreSQL, with SQL migrations in `supabase/`.
- No `package.json` or automated frontend test/lint suite was found at the expected root path. GitHub Pages workflow is a static deployment workflow, not a test/build pipeline.

## Existing foundations found in source

- Email/password authentication and session restoration in the owner workspace.
- Platform Super Admin check and restaurant membership roles.
- Restaurant onboarding, restaurant/order lists and multi-item order creation.
- Server-side order status transition enforcement and order status history.
- Menu categories/items and public published-menu read policies.
- Customer email/password login, customer contact profile, addresses, checkout RPC, order history and Realtime order-status foundations.
- Financial snapshot, reconciliation and weekly settlement-draft foundations.
- Existing documentation explicitly says live payments, marketplace settlement, automated refunds, live Zomato/Swiggy APIs, full POS and production security/monitoring are not complete.

## Important gaps and safeguards

1. **External platform manual entry:** the order form exposed Zomato/Swiggy demo channels to users who could create orders, while the order RPC checked restaurant membership rather than the Owner-only external-entry rule. The UI now hides those channel options from non-Owners, and a forward-only database migration has been added to enforce the rule server-side.
2. **Order status control:** the UI previously allowed Managers to advance order status, while the approved workflow says the Owner controls status updates. The UI now restricts status controls to Owner/Super Admin, and the same forward-only database migration adds a server-side guard.
3. **Migration not yet applied:** `supabase/phase4_external_channel_owner_guard.sql` is committed but has **not** been run against the live Supabase project. Apply it only after confirming the existing migration baseline; do not rerun the original schema chain.
4. **Role permissions:** the current UI uses broad hard-coded role visibility, not the full per-employee configurable permission matrix. Hiding a button is not security; granular permissions need database/RPC enforcement in a later phase.
5. **Payments:** customer checkout currently creates an order and a pending financial snapshot. It does not collect money. No real payment provider, split settlement, refund execution or bank payout is connected.
6. **External APIs:** Zomato/Swiggy choices are labelled demo/manual; there is no verified live API connection. Partner access and approved API credentials are prerequisites.
7. **Deployment status:** a push to `main` triggers the Pages workflow, but the workflow run result and live-browser behavior were not available in this repository audit. Do not treat a commit as proof that the live website has deployed successfully.
8. **Live database status:** repository SQL and setup documentation were inspected. The current Supabase schema, migration history, RLS behavior and actual production data were not queried in this audit.

## Changes made during Phase 0

- Added `docs/PRODUCT_BLUEPRINT.md` as the approved 120-answer product baseline and phased delivery roadmap.
- Updated `index.html` so only Owner/Super Admin can select manual Zomato/Swiggy channels and advance order statuses.
- Added `supabase/phase4_external_channel_owner_guard.sql` to enforce those two rules in PostgreSQL, including a server-role path for a future approved backend connector.
- Updated `SUPABASE_SETUP.md` with the new migration order.

## Phase 0 acceptance checklist

- [x] Confirm repository identity, default branch and push permission.
- [x] Inspect current owner and customer entry pages.
- [x] Inspect the documented SQL migration sequence and major RPC/policy foundations.
- [x] Record product requirements and implementation roadmap.
- [x] Add UI-level safeguards for Owner-only external manual entry and order status changes.
- [x] Add forward-only database guard migration.
- [ ] Run the new migration in a safe/test Supabase environment.
- [ ] Verify Owner, Manager and Staff restrictions against the database (including direct RPC/API attempts).
- [ ] Confirm GitHub Pages deployment run and test the deployed pages on Android and desktop.
- [ ] Inspect actual live Supabase schema/migration history and run tenant-isolation tests.

**Phase 0 is partially complete.** The repository baseline and first permission correction are committed. Database application, live deployment verification and real-device testing remain outstanding.


## Live Supabase verification update — 2026-11-06

The live Supabase project `wedbgpybbgsszcmffoha` was subsequently inspected through the connected Supabase integration. This section supersedes the earlier repository-only scope statement above.

- Project status: ACTIVE_HEALTHY; PostgreSQL 17.
- RLS is enabled on all inspected public application tables.
- Live data counts at verification: 10 orders, 11 order items, 42 order-status history rows; these counts were unchanged by the hardening work.
- The two order guard triggers are present on `public.orders`.
- The live guard functions were verified to check restaurant Owner membership for external-channel entry and status changes; they do not rely on a Super Admin bypass.
- Phase 5 migration applied successfully: ten missing foreign-key indexes added; profile own-row policies and order insert policy use initplan form for `auth.uid()`.
- Post-migration verification confirmed all ten indexes, three optimized profile policies, both order guard triggers and unchanged order counts.
- Security advisor still reports callable SECURITY DEFINER functions. These were reviewed as purpose-built RPCs/helpers: customer checkout is intentionally callable by customers, public restaurant listing returns only published restaurant fields, customer order history is scoped to `auth.uid()`, settlement draft and payment reconciliation require Super Admin, and permission helpers support RLS. Their EXECUTE grants were not blindly revoked because doing so could break RLS and required application workflows.
- Supabase Auth leaked-password protection remains disabled. The connected database tool does not expose the Auth dashboard setting; this remains a dashboard-level configuration task.
- Performance advisor no longer reports unindexed foreign keys or auth initplan warnings. It still reports overlapping permissive policies (intentional combinations of customer/team/platform-admin access) and unused indexes. Unused indexes were not dropped because current data volume is small and future query paths are expected.
- Supabase health advisor returned no findings.
- No customer/business rows were deleted or modified during the audit.

## Remaining release gates

- Verify GitHub Pages deployment run for the latest commit and perform actual browser/device smoke tests.
- Configure leaked-password protection in Supabase Auth dashboard when the setting can be accessed.
- Add automated tenant-isolation and role-based integration tests (Owner, Manager, Staff, Customer, Super Admin) before enabling more financial or staff-management operations.
- Obtain a proper database export/backup before any future destructive schema or data changes. No downloadable backup was created as part of this phase.
