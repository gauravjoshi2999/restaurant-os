# Bite Phase 1 QA Run — 8 November 2026

## Scope
This run verifies the Phase 1 foundation and the three existing application surfaces against the current Master Prompt. All synthetic records are explicitly marked as demo data. No live payment was attempted and no customer money was moved.

## Live database changes
- Added `is_demo` markers to `orders`, `order_financials`, and `restaurant_expenses`.
- Seeded October 1–31, 2026 into Demo Royal Thali House: 62 simulated orders (2 per day), 124 order items, 314 order status history events, 62 financial snapshots, and 31 simulated expenses.
- Every demo order uses channel `Bite Demo Simulation`, has `is_demo=true`, and contains an explicit no-payment/no-fulfilment note.
- Every demo financial snapshot remains `payment_status='unpaid'` and `settlement_status='not_ready'`; no payment or settlement is represented as successful.
- The default platform commission read from the database is 10.00%; all 62 demo financial snapshots use 10%.
- Existing real rows were not deleted or overwritten.

## Executed database checks
| Test | Result |
|---|---|
| Demo month coverage | PASS — 31 distinct dates, 62 orders |
| Demo line items and history | PASS — 124 items, 314 status events |
| Demo financial safety | PASS — 62 unpaid / not-ready snapshots |
| Demo expenses | PASS — 31 records, all flagged demo |
| Commission consistency | PASS — default 10%, no demo snapshot mismatch |
| Owner tenant isolation | PASS — Demo Royal owner sees 71 own orders and 0 orders from Demo Pizza Junction; 33 own expenses and 0 foreign expenses |
| Foreign menu write | PASS — 0 rows changed for another restaurant |
| Admin scope | PASS — admin check true; 10 restaurants and 80 orders visible |
| Public discovery | PASS — 5 restaurants listed; 0 unapproved restaurants published |
| Customer checkout guard | PASS — checkout RPC raises the configured “payment provider not configured” block before order creation |
| Payment safety | PASS — no gateway credentials/provider, no real payment, no fake paid record |
| Settlement protection | PASS by function inspection — only paid, completed Own Platform orders with actual gateway fee are eligible; demo records remain unpaid and cannot enter a settlement draft |

## Frontend and deployment checks
- Added `scripts/check_frontend.py` to parse all inline JavaScript in `customer.html`, `index.html`, and `delivery.html` with Node syntax checks and assert critical role/payment guards.
- Added GitHub Actions workflow `Bite QA` to run these checks on pushes and pull requests.
- Bite QA run: SUCCESS — [GitHub Actions](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42443068007).
- GitHub Pages deployment run: SUCCESS — [GitHub Actions](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42443067992).
- Owner dashboard now marks demo data, opens the October demo month by default in Reports, displays demo labels on order/financial rows, and calculates the PAID SALES tile from verified non-demo paid financial snapshots only.
- Owner order mapping now includes delivery type and address snapshot so the Ready → delivery handoff action can be selected for valid marketplace delivery orders.

## Important release blockers — do not call the marketplace production-ready
1. No approved marketplace payment provider or merchant onboarding is connected. Customer checkout is deliberately fail-closed. The full customer-paid order journey cannot be completed until provider test credentials, split-settlement setup and webhook verification are available.
2. Supabase Auth leaked-password protection is disabled. The connected Supabase tooling does not expose this Auth security setting; enable it in Supabase Dashboard → Authentication → Security before production.
3. Supabase Security Advisor reports 5 anon-callable and 24 authenticated-callable SECURITY DEFINER functions. Public discovery and delivery capability-link RPCs are intentionally callable, but all functions still require a documented per-function least-privilege review and rate-limit verification. The delivery handoff table itself has RLS enabled and no direct policies; it is intended to be accessed through the narrow token RPCs.
4. Two existing owner accounts are linked to more than one restaurant, and one restaurant has two owner memberships. These records were not auto-reassigned or deleted. The login path blocks ambiguous multi-restaurant owner accounts; the affected owner-to-restaurant mapping must be resolved by the platform administrator.
5. A separate customer-only Auth account was not available for a valid customer-vs-customer RLS impersonation test; the available customer test account is also a Platform Admin. Customer isolation therefore remains unverified by a negative live-account test.
6. Delivery-link positive handoff could not be completed with the seeded demo orders because they intentionally have no real customer Auth identity or customer address ownership. The link page and RPC wiring passed static checks; a positive handoff test must use a dedicated test customer and a real saved address.
7. A full interactive browser/mobile end-to-end test was not available in this tool session. The CI run verifies inline JavaScript syntax and critical guards, not actual browser rendering, taps, notifications, or responsive screenshots.

## Release decision
**Phase 1 foundation: substantially implemented and database-smoke-tested. Production acceptance: NOT YET PASSED.** Keep the marketplace in demo/closed-checkout mode until the blockers above are cleared and the customer → owner → delivery → admin journey passes in a real browser using the provider's sandbox.


### Additional checks after the initial QA run
- Added and applied `bite_phase1_delivery_area_approval_guard`; the public delivery-area RPC now returns no result for a pending/unapproved restaurant. Verified the function definition and a pending-restaurant test returned 0 rows.
- Verified a foreign Owner's menu update affects 0 rows.
- Verified the direct public role has no table privilege on `restaurant_delivery_handoffs`; the table remains inaccessible directly and the public delivery page uses token RPCs only.
- Verified an invalid delivery capability token returns 0 handoff records.
- Added the exact applied SQL migration files and idempotent `supabase/demo_seed_october_2026.sql` seed script to the repository.
- Latest deployment rerun completed successfully on attempt 2: [GitHub Pages deploy](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42443136837). Latest Bite QA passed: [Bite QA](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/42443136830).
- Latest Supabase Security Advisor still reports: 1 Auth leaked-password warning, 5 anon-callable SECURITY DEFINER RPCs (public discovery/delivery capability endpoints), 24 authenticated-callable SECURITY DEFINER functions, and 1 RLS-enabled delivery-handoff table with no direct policies. Performance advisor reports 20 multiple-permissive-policy warnings. No database health advisories were reported.


### Admin approval and Owner MVP scope follow-up
- Added explicit Platform Admin Approve / Reject / Suspend / Reactivate actions. Approval writes `onboarding_status`, reviewer and review timestamp, sets operational status to Active, and leaves customer publication off until separately published after menu readiness.
- Database permission test: Platform Admin approval update succeeded inside a rolled-back test transaction; a Restaurant Owner attempting the same update changed 0 rows.
- Public delivery-area checks now require approved onboarding; a pending restaurant returned 0 rows.
- Owner routes now allow only Overview, Website Orders, Menu, Expenses, Reports and Settings. Legacy POS, tables, khata, stock, HR and manual offline order entry are hidden/blocked. Existing legacy rows remain stored but Owner order boards and reports filter them out; only marketplace and clearly marked demo orders are shown.
- Owner order model now carries delivery type/address snapshot so the Ready delivery action can show the WhatsApp handoff option for eligible customer delivery orders.
- Updated legacy `invite-restaurant-owner` Edge Function to reject Platform Admin accounts and existing accounts already linked to another restaurant; deployed active version 3. The primary Owner provisioning function already had the same single-restaurant guard.
- Customer order-history RPC test returned only 3 orders for the signed-in customer identity while the database held 80 total orders. Note: the available test identity is also a Platform Admin, so this does not replace a dedicated customer-only RLS test.


### Legacy POS RPC access hardening — 2026-11-08
- Applied `20261108034400_bite_phase1_disable_legacy_manual_order_rpcs.sql` to revoke browser `anon`/`authenticated` execution on the three legacy manual/POS order-creation RPCs. `service_role` remains available for controlled backend operations.
- Verified live grants for all three functions: anon=false, authenticated=false, service_role=true.
- Supabase Security Advisor authenticated-callable SECURITY DEFINER warnings decreased from 24 to 23. Remaining function warnings are not blanket-revoked because customer, owner and Admin workflows still depend on reviewed RPCs.


### Customer Phase A — Signup and address book regression — 2026-11-08
- Live signup reported successful by the operator; Auth user exists and the matching `public.profiles` row was created by `on_auth_user_created` / `handle_new_user()`. The latest confirmed account was verified against its matching profile UUID.
- Verified `profiles` RLS: the signed-in identity sees its own profile (1 row) and a different identity's profile (0 rows).
- A2 code audit found the initial customer address flow saved a new address only during order submission. Because payment is deliberately fail-closed pending provider onboarding, this made address-book setup unavailable independently of checkout.
- Added an independent Account → Saved addresses form with create, edit, delete and default-address actions, client-side validation, and user-visible errors. Added mobile-friendly input styling and static QA guards.
- Live database regression: under an authenticated Customer JWT context, address INSERT, own-row SELECT, UPDATE and DELETE assertions passed; cross-customer address visibility returned 0 rows. The entire test transaction was rolled back; no QA address was retained.
- JavaScript syntax compilation of the updated customer page passed. The newly-triggered GitHub Actions run for the latest commits was not yet available at the time of this note; do not count CI as passed until its run is completed.
- Remaining A2 acceptance: perform one real signed-in browser save/edit/default/delete/refresh cycle with a dedicated Customer-only identity. The current available test identity is not yet proven Customer-only. No actual order/payment was created.
