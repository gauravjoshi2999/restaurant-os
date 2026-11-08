# Bite Phase 1 — Current Handoff Status
Date: 2026-11-08

## Product scope
The authoritative scope is `docs/PRODUCT_BLUEPRINT.md`: one Bite marketplace with exactly three panels (Customer, Restaurant Owner, Platform Admin). The initial release excludes POS/counter sales, dine-in, inventory, suppliers, HR, customer khata, daily cashbook/closing, multiple branches, Zomato/Swiggy manual channel workflows, hotel modules, platform delivery fleet and subscriptions. Legacy tables and records are retained for data safety.

## Verified foundation
- Repository: `gauravjoshi2999/restaurant-os`; GitHub Pages static frontend; Supabase Auth + PostgreSQL 17 + RLS.
- Supabase project status: ACTIVE_HEALTHY.
- Live public schema: 40 tables; all 40 have RLS enabled; 111 RLS policies.
- Restaurant onboarding lifecycle and database approval guard applied; live counts: 5 approved, 5 pending.
- Public restaurant discovery requires approved + active + published.
- Configurable default platform commission is 10%; optional per-restaurant Admin override is supported.
- Owner workspace is scoped to one restaurant and routes: Overview, Orders, Menu, Expenses, Reports, Settings. Ambiguous multi-restaurant Owner accounts are blocked instead of silently selecting a restaurant.
- Platform Admin can approve/reject/suspend/reactivate restaurants; approval permission is enforced at database level.
- Demo Royal Thali House has 62 simulated orders across all 31 days of October 2026, 124 order items, 314 demo status events, 62 unpaid demo financial snapshots and 31 demo expenses. Demo data is marked and must never be represented as real sales or payment.
- Previous QA evidence: tenant isolation checks passed for the tested Owner identity, foreign menu write was denied, Admin scope check passed, unapproved restaurants were excluded from discovery, and checkout is fail-closed while no payment provider is configured.
- Legacy browser-facing manual order creation RPCs are now disabled for anon/authenticated roles; service_role is retained for controlled backend workflows. Live grants were verified after migration.
- Supabase health advisor currently reports no health lints.

## Latest hardening
Migration: `supabase/20261108034400_bite_phase1_disable_legacy_manual_order_rpcs.sql`

Revoked anon/authenticated execution:
- `create_order_with_items`
- `create_pos_order_with_balance_action`
- `create_pos_order_with_payment`

Live verification: for all three functions, anon=false, authenticated=false, service_role=true. This enforces the initial-release no-POS rule at the API privilege layer, not only in the UI.

## Release blockers — must be resolved before production acceptance
1. **Marketplace payment provider:** no approved provider credentials/merchant onboarding or signed webhook integration are configured. Checkout intentionally remains blocked; do not collect real customer money or fake a successful payment. Select and onboard a provider that supports Indian marketplace split settlement, KYC, refunds and reconciliation; then implement/test provider sandbox + verified webhooks.
2. **Auth password protection:** Supabase leaked-password protection is disabled. Enable it in Supabase Dashboard → Authentication → Security (available on eligible plans) and verify.
3. **Owner membership conflicts:** two Owner accounts are linked to more than one restaurant, and one restaurant has two distinct Owner memberships. Do not auto-delete/reassign. Platform Admin must confirm the intended mapping before enforcing a unique owner constraint.
4. **Customer-only RLS test identity:** a dedicated Customer-only Auth account is required to complete customer-vs-customer negative isolation tests. The available test account also has Platform Admin privileges, so it is not a valid isolation test identity.
5. **Positive delivery handoff E2E:** test with a dedicated customer account and a real saved delivery address. Demo orders are not suitable because they have no real customer identity/address ownership.
6. **Browser/mobile E2E:** static JS checks and SQL smoke tests are not a substitute for real browser tests. Run Customer → checkout sandbox → Owner accept/prepare/ready → WhatsApp delivery link → OTP delivered → Admin review/financial view on Android mobile and desktop.
7. **SECURITY DEFINER review:** Security Advisor still reports 5 anon-callable and 23 authenticated-callable SECURITY DEFINER functions. The 5 anon RPCs are intended public discovery/delivery capability endpoints; review all functions individually for least privilege, ownership checks, token entropy/expiry and rate limits. Do not blanket-revoke required workflows.
8. **RLS policy performance:** Security Advisor reports 20 multiple-permissive-policy warnings. Review and consolidate only after confirming policy semantics and regression tests. `restaurant_delivery_handoffs` intentionally has no direct table policies and should remain accessible only through narrowly scoped token RPCs; verify that pattern during security review.

## Acceptance rule
Phase 1 foundation is substantially implemented and database-smoke-tested, but **production acceptance is NOT PASSED** until all blockers above are closed and the real three-role browser journey passes. A successful GitHub Pages deployment or static JavaScript check alone is not release acceptance.


## Fresh verification update — 2026-11-08

Live database role-isolation checks were rerun with actual transaction-scoped `SET LOCAL ROLE authenticated` and JWT subject claims (test transactions rolled back):
- Customer-only identity: 1 own profile, 0 foreign profiles, 0 visible orders, 1 own saved address, 0 foreign addresses, 0 restaurant memberships.
- Demo Royal Thali House Owner identity: 1 restaurant membership, 71 own orders, 0 foreign orders, 33 own expenses, 0 foreign expenses.
- Platform Admin identity: 11 profiles, 10 restaurants and 80 orders visible.
- Delivery handoff table: no direct anon/authenticated SELECT or INSERT privileges; its no-policy RLS posture is intentional and token RPC-only.
- `admin_list_owner_assignments()` works under the Platform Admin JWT context. No owner mappings were modified during this verification.

The current assignment conflicts are confirmed: `gauravjoshi2999@gmail.com` (Platform Admin) is also a legacy Owner member of Hotel Maharani Palace and Test Restaurant; `joshi.gaurav.dipty@gmail.com` is Owner of both Bajrang Hotel and Gg Restaurant; Gg Restaurant has a second Owner membership with no email on the Auth user. These records must be resolved through the Admin mapping workflow after the intended single Owner login is confirmed. No account or restaurant data was deleted or reassigned.

Current live Security Advisor snapshot: 3 anon-callable and 29 authenticated-callable SECURITY DEFINER findings, one intentional RLS-enabled/no-policy notice for token-only delivery handoffs, and leaked-password protection disabled. No `PUBLIC EXECUTE` grant was found in the inspected SECURITY DEFINER function ACLs. Performance Advisor reports 16 multiple-permissive-policy warnings; policies have not been consolidated without complete regression coverage.

The payment journey remains fail-closed. Cashfree Easy Split (marketplace vendor splits, commission, vendor settlements and refunds) is the relevant Cashfree product to onboard; ordinary PG checkout alone does not establish the required marketplace split-settlement arrangement. No Cashfree merchant credentials, Easy Split activation, vendor KYC or webhook secret are present in the project, so no real payment can yet be created or verified. Never enable checkout or mark an order paid before the server-side provider verification and signed webhook are in place.
