# Bite P0-3b — Cashbook daily closing database serialization

**Status:** Draft migration only; do not deploy to production without staging validation and Owner approval. This is independent of Draft PR #20 (frontend closing review).

## Ground truth: live Supabase read-only schema inspection (13 Nov 2026)

The production ledger is `public.restaurant_cashbook_entries`, a `security_invoker=true` UNION ALL view. It has exactly seven source tables:

| Ledger source | Source table | Date column | Cash flow |
|---|---|---|---|
| Expenses | `restaurant_expenses` | `expense_date` | Out |
| Paid purchases | `restaurant_purchases` | `purchase_date` | Out when paid_amount > 0 |
| Manual cashbook | `restaurant_cashbook_manual_entries` | `entry_date` | In or out |
| POS receipts | `restaurant_order_payments` | `payment_date` | In |
| Staff salary/advance/bonus | `restaurant_employee_payments` | `payment_date` | Out |
| Customer khata repayments | `restaurant_customer_ledger_entries` | `entry_date` | In when entry_type = credit |
| POS refunds | `restaurant_order_refunds` | `refund_date` | Out when refund_amount > 0 |

The current closing table is `restaurant_cashbook_closings` with `UNIQUE(restaurant_id,close_date)`; the existing RPC is `close_restaurant_cashbook_day(uuid,date,numeric,numeric,text)` returning UUID. It is `SECURITY INVOKER` and Owner-authorized. These names and signatures are preserved. The earlier generic research example using `payments`, `daily_closings`, and `pg_advisory_xact_lock_rest` does **not** match this schema and must not be executed.

## Why a new guard is necessary

Existing guards check for closed days without locking the source write and closing together. A POS payment could check that a day is open while a closing transaction computes its cash total, then commit after closing. In addition, Staff cannot SELECT the closing table under RLS, so existing Staff INSERT guards cannot reliably see a closed day. A frontend-only review cannot resolve these database races.

## Design

- Add a `SECURITY DEFINER` BEFORE INSERT/UPDATE/DELETE guard on **all seven** source tables. The function is a fixed allowlist, has `search_path=''`, has no dynamic SQL, and direct EXECUTE is revoked. Its sole privileged read is the closing table, so Staff writes cannot bypass closed-day protection because of RLS visibility.
- All source writes and closing calculations acquire the same **transaction-scoped advisory lock** for the restaurant UUID and business date, derived from `hashtextextended('bite.cashbook.day.v1|' || restaurant_id || '|' || date, 0)`. Hash collisions can reduce concurrency but cannot allow inconsistent closes.
- UPDATEs touching two days or restaurants acquire both keys in ascending BIGINT order. Both OLD and NEW days are checked, so a closed-day entry cannot be edited, deleted, or moved to another day.
- The existing `calculate_cashbook_closing` trigger acquires the lock before summing the ledger. It validates non-negative finite amounts, two-decimal precision, non-negative expected drawer cash, and an 8+ character explanation for any discrepancy. Only `Cash` affects physical drawer totals.
- The existing `close_restaurant_cashbook_day` RPC keeps its name/signature. It locks before checking for an existing closing. An **identical retry returns the original UUID** without changing audit data; conflicting retries raise an error. The closing trigger remains authoritative for totals, including direct table INSERTs.
- Existing Owner/Manager/Staff RLS and POS order validation triggers remain intact. No changes to online ordering, restaurant menu/settings, frontend files, WhatsApp, or payment workflows.

## Automated CI

The new `cashbook-postgres-qa` job runs on an **ephemeral PostgreSQL 17 service**, not Supabase production:

1. Create a synthetic fixture with the seven date columns, closing RLS, and a mock Owner membership.
2. Apply the exact migration file to that fixture.
3. Execute a rollback-only SQL test: Cash vs UPI, duplicate/changed retry, mismatch reason, numeric validation, staff unable to read closings but still blocked from writing, INSERT/UPDATE/DELETE/moving a closed-day entry, and unauthenticated closing.
4. Open two PostgreSQL sessions: one holds the restaurant/day advisory lock; the other tries to insert a source row with a 500ms lock timeout. The insert must wait/time out; after lock release, the same open-day write must succeed.

This is **synthetic integration coverage**, not proof of production compatibility. The actual Supabase RLS and existing triggers must also be tested in a staging clone with representative Owner/Manager/Staff roles, POS save/refund, purchase, expense, employee, khata, and manual cashbook flows. Run a two-session test with the real `close_restaurant_cashbook_day` RPC versus an in-flight POS receipt.

## Production release gates

- [ ] GitHub Actions `static-qa` and `cashbook-postgres-qa` green.
- [ ] Staging schema and migration tested with real Supabase auth and all seven source write paths.
- [ ] RLS cross-restaurant, Manager, Staff, and unauthenticated cases verified.
- [ ] Real two-session close-versus-source-insert test on staging.
- [ ] Android Owner closing review PR #20 integration verified; matching discrepancy note behavior.
- [ ] Audit of any pre-existing closed days for late entries, if applicable; migration does not retroactively reconcile historical closings.
- [ ] Owner explicitly approves migration and rollout. Back up first and monitor errors.

**Known boundary:** Updates to unrelated descriptive lookup records (e.g. customer display name or supplier name) may alter ledger *descriptions*, not cash totals. This migration protects the seven financial source rows. It does not introduce a restaurant timezone setting or change the existing business-date semantics. Database superusers can disable triggers; treat such access as privileged operations.
