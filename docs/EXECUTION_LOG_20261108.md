# BITE execution log — 8 November 2026

This log records changes actually applied during the 8 November hardening pass. It does not certify the marketplace as production-ready.

## Changes applied

- Corrected the Owner Overview online-order KPI: it now renders the numeric count instead of reading `.length` from a number.
- Corrected Owner and Super Admin sales metrics: only verified-paid, non-demo BITE financial snapshots contribute to sales, and demo orders do not inflate live-order counts.
- Routed the 62 October `Bite Demo Simulation` orders into the BITE website order board for workflow testing, with a visible `DEMO ONLY` label; they remain excluded from live metrics and settlement totals.
- Restricted realtime new-order alerts to BITE website orders only; legacy aggregator channels no longer trigger Owner alerts.
- Corrected `place_customer_order` financial snapshot creation. The legacy 18% literal was replaced with the restaurant's configured commission override or the platform default (10%). The function now calculates the commission from that rate.
- Added a customer forgot-password entry point using Supabase Auth `resetPasswordForEmail`, recovery-session handling using `PASSWORD_RECOVERY`, password confirmation, and `updateUser({ password })`. The recovery screen no longer requires the customer to re-enter an email after returning from the secure reset link.
- Added duplicate Owner assignment checks to both live Owner provisioning Edge Functions:
  - `create-restaurant-owner-login` version 7
  - `invite-restaurant-owner` version 4
- Added a frontend Owner access guard that blocks accounts linked to multiple restaurants and restaurants with more than one Owner assignment.
- Added a database trigger that blocks a second Owner assignment to the same restaurant, rejects Platform Admin accounts being newly assigned as restaurant Owners, and serializes concurrent Owner assignments with a transaction-scoped advisory lock. Existing ambiguous membership rows were deliberately not reassigned or deleted.
- Version-controlled the live Owner provisioning Edge Function sources and the database migrations in `supabase/`.

## Live database verification performed

- 40/40 public tables have RLS enabled.
- The commission function no longer contains the old 18% literal; the platform default is 10.00%.
- A conflicting Owner insert was rejected by the database trigger; the test transaction left the existing membership count unchanged. The same-owner idempotent update was also accepted, and the concurrency-safe trigger re-test passed.
- A Platform Admin account could not be inserted as a restaurant Owner; the test transaction was rolled back.
- Owner restaurant profile update was permitted, while an Owner attempt to change the protected commission rate was rejected; transaction rolled back.
- Checkout was exercised with a valid customer, saved address, restaurant and menu item. The unconfigured payment provider guard rejected the checkout before an order was created; transaction rolled back.
- Delivery handoff positive database journey passed: Owner creates link, customer-only OTP lookup, bearer-link lookup, Owner marks Handed Over, OTP confirmation marks the order Completed and consumes the token. All test rows were rolled back.
- Delivery OTP negative journey passed: five wrong attempts were counted and the sixth attempt was blocked. All test rows were rolled back.
- All inline JavaScript in `customer.html`, `index.html`, and `delivery.html` parsed successfully in a V8 syntax check. Static regression assertions passed for password recovery, Owner mapping, KPI calculations, demo labelling, BITE-only alerts and secret-key absence.
- Chromium smoke coverage was extended for the customer forgot-password entry and the mobile Owner/Admin sign-in gate; the latest GitHub Actions result still needs to be checked before calling those browser tests passed.
- Static QA and Chromium smoke scripts were extended to cover password recovery entry and Owner KPI / Owner mapping regressions. Their latest GitHub Actions run must be checked separately; a syntax check is not a browser E2E pass.

## Data integrity deliberately preserved

Existing Owner membership conflicts remain in the database because the intended account-to-restaurant mapping cannot be inferred safely. New conflicting assignments are blocked at the database, Edge Function and login layers. No historical membership or customer data was deleted.

## Release safety

Cashfree merchant review / marketplace split-settlement approval is external to this repository. Checkout remains fail-closed; no payment success, order creation, refund or settlement is simulated. The Supabase Auth leaked-password protection setting is still reported disabled by Security Advisor and must be enabled in the Supabase Auth security settings before production acceptance.


## Additional RPC privilege hardening — 8 November 2026

- Audited the five anon-callable SECURITY DEFINER RPCs against the live Customer and Delivery frontend call sites.
- The public Customer storefront uses `list_public_restaurants()`; the public delivery handoff page requires `get_delivery_handoff(text)` and `confirm_delivery_handoff(text,text)`.
- `check_restaurant_delivery_area(uuid,text)` and `is_restaurant_public(uuid)` are not called by the current public frontend. Anonymous EXECUTE was revoked for these two helpers while authenticated access was retained.
- Live privilege verification passed: both helpers now return `anon_can_execute=false`; the three required public endpoints remain callable by anon.
- Security Advisor anon-callable SECURITY DEFINER findings reduced from 5 to 3. Authenticated-callable findings remain 23; no blanket revocations were made because the app's authenticated RPCs and RLS helpers require role-aware access.
- RLS remains enabled on all 40 public tables. The RPC-only delivery handoff table intentionally remains without direct table policies and continues to deny direct table access.
- The latest Pages deployment run 42451337908 and BITE QA run 42451337932 both completed successfully. QA's browser job is still the public Customer smoke suite; it is not authenticated Owner/Admin E2E.


## Owner availability controls — 8 November 2026

- Added restaurant fields for opening/closing time, temporary closure flag and optional reopen timestamp, plus a separate delivery-paused flag.
- Added a database BEFORE INSERT guard for `Own Platform` orders. It blocks new marketplace orders while a restaurant is temporarily closed and blocks delivery orders while delivery is paused; pickup remains permitted when only delivery is paused.
- Updated `list_public_restaurants()` to return the new availability fields to the public Customer storefront. Public execution is explicitly granted to `anon`, `authenticated` and `service_role`; PUBLIC grant is revoked. The trigger function has no anon/authenticated EXECUTE grant.
- Added Owner Settings controls and corrected delivery-zone loading to use the signed-in Owner's restaurant membership instead of `state.restaurants[0]`.
- Customer restaurant cards and restaurant detail now display temporary closure / delivery pause; the Continue button is disabled while a restaurant is temporarily closed.
- SQL transaction tests passed: closed restaurant rejects marketplace pickup; delivery-paused restaurant rejects delivery; pickup is not blocked by delivery pause. Test transaction was rolled back.
- Live schema check: 40/40 public tables retain RLS; public listing RPC still has anon execution; trigger function denies anon/authenticated execution.
- Added static QA assertions and Chromium smoke assertions for the new availability response fields and customer closure state. These new CI assertions still require a completed Actions run before being marked passed.


## Audited Owner mapping repair workspace — 8 November 2026

- Added Platform Admin-only RPCs `admin_list_owner_assignments()` and `admin_resolve_owner_mapping(uuid,uuid)`.
- The list RPC returns each restaurant's Owner count and each Owner login's restaurant count, plus account contact fields for Platform Admin review. Anonymous execution is revoked; only authenticated callers can invoke the RPC, and the function enforces `is_platform_admin()`.
- The resolver requires Platform Admin, refuses Platform Admin accounts as Owners, uses transaction advisory locks, keeps the selected account as the sole Owner for the selected restaurant, removes that account's memberships from other restaurants, removes competing Owner assignments on the selected restaurant, and records the before-state in `platform_audit_logs`.
- Added a Platform Admin Owner mapping workspace on the Restaurants page. It identifies missing/duplicate assignments and requires an explicit confirmation before changing membership; a read-only audit does not change accounts.
- Added `platform_audit_logs` with RLS enabled. Anonymous SELECT is denied; authenticated SELECT is granted but RLS restricts rows to Platform Admins; direct authenticated INSERT is denied.
- SQL test executed as a Platform Admin inside a transaction: mapping list RPC and resolver success path both executed; audit row was created inside the transaction. Transaction was rolled back. Follow-up query confirmed no test audit row persisted and the original mapping conflicts remain unchanged.
- Live grants verified: both mapping RPCs deny anon execution and allow authenticated invocation subject to the internal Platform Admin check.
- Actual production membership mapping has intentionally not been changed: the correct person-to-restaurant choice must be selected by the Platform Admin using the new review panel. No customer, order, restaurant or historical financial data was deleted.


## Platform Admin audit log viewer — 8 November 2026

- Added a dedicated Audit Log navigation page to the Platform Admin workspace; Owner navigation remains exactly six approved sections.
- The Admin viewer reads the latest 200 rows from `platform_audit_logs`, displaying timestamp, actor identifier, action, entity and JSON details. It relies on the table's Platform Admin-only SELECT RLS policy; no direct authenticated INSERT permission exists.
- Added static QA coverage for the Admin-only audit page and the Owner mapping controls. The updated CI workflow has not yet been independently confirmed green in this session.


## Customer support ticket workflow — 8 November 2026

- Added `customer_support_tickets` with category, subject, message, optional customer-owned order link, status, Admin response and timestamps.
- RLS is enabled. Customers can read only their own tickets and create tickets only for themselves; an attached order must belong to the same customer. Customers have no UPDATE or DELETE policy. Platform Admins can read and update tickets.
- Added update timestamp handling and an audit trigger that records ticket creation and Admin status/response changes in `platform_audit_logs`.
- Added Customer Account support form and support history, including optional order selection; added Platform Admin Customer Support queue with status and response controls.
- SQL test ran as an authenticated Customer: ticket insert succeeded, own-ticket read succeeded, customer update was denied by RLS. The test transaction was rolled back and a follow-up query confirmed zero persisted QA tickets.
- Live schema check now reports 42 public tables and 42 with RLS enabled.
- Static QA assertions were added for Customer ticket submission/history, Admin queue and RLS/audit migration. Updated GitHub Actions results still need independent confirmation.
