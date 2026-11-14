# Bite Customer — Saved Address Safety & Mobile Editing
Date: 2026-11-14

## Audit findings
The existing Account screen offered Save/Edit/Make default/Delete for authenticated customers, but lacked consistent customer-id filters on client update/delete actions. RLS already protects the table, and a **read-only** Supabase inspection confirmed `customer_addresses` RLS enabled with the existing `customer_id = auth.uid()` policy. This patch adds explicit filtering as defense in depth rather than replacing RLS.

The former default address flow first cleared every default flag and then set a different address to default. If the second write failed, the account could have no default address. A failed save after clearing the old default could cause the same issue.

## Changes
- Default promotion sets and verifies the target address first, then clears the other saved addresses for the **same authenticated customer**. If clearing the others fails, a best-effort compensating rollback removes the new default flag and presents a retry message.
- Address save preserves the old default until the new/edited address has been written and confirmed, then promotes it. If an address was stored but default promotion failed, the address list refreshes and the form resets: retrying will not accidentally insert a duplicate.
- Save/Edit/Delete/Make default use explicit `customer_id` predicates and an in-flight mutation guard. Target row existence is checked before mutation.
- Edit action fills the existing address form, scrolls it into view and focuses the name input. Touch buttons are at least 46px high with visible keyboard focus; saved-address actions get accessible labels and explicit button types.
- When a customer signs out while looking at their account, the UI returns to Home instead of leaving a logged-out customer on their private account view.
- Account address reads use the authenticated customer ID in addition to existing RLS and session-request identity checks.

## Tests
- New `scripts/customer_address_book_safety.test.cjs` runs the real default-promote helper against an isolated mock of Supabase calls. It tests customer scoped updates, successful default promotion, failure before old default clearing, failure/compensating rollback and missing-address handling.
- Existing logout and account-race fixtures updated for explicit customer-scoped reads and navigating away from Account after logout.
- `scripts/browser_smoke.py` validates real Account markup and Edit → populated form → Cancel on desktop and mobile using in-memory synthetic address data, without any Supabase writes.
- Full frontend/Chromium and PostgreSQL regression tests must pass in PR and again on the merged branch before publishing.

## Boundaries and remaining work
This is **client-side failure compensation, not a database transaction**. If both the clear operation and the compensation request fail, a manual refresh/reconciliation may be needed. A database-backed atomic default-address RPC would be a future hardening option and requires separate migration/testing.
No SQL, live address records, Supabase RLS policy, Cashfree, checkout total, restaurant mapping or Owner/Admin code was modified. Manual authenticated mobile-device tests and payment readiness checks remain outstanding.