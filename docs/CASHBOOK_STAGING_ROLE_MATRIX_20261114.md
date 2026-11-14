# Bite Cashbook — Staging Role Matrix Gate (14 November 2026)

## Environment discovery
The connected Supabase account's project list contains only **restaurant-os** (`wedbgpybbgsszcmffoha`). This is the existing live database. **No independent Supabase staging project was discoverable**, so no live-data or live-schema write was attempted.

The production catalog was queried READ ONLY:
- `public.restaurant_cashbook_entries` is a `security_invoker=true` seven-source ledger view.
- The original closing RPC is `close_restaurant_cashbook_day(uuid,date,numeric,numeric,text)`, `SECURITY INVOKER`; its current body does not acquire the staged transaction advisory lock.
- The current closing SELECT policy admits Owner and Manager; INSERT permits only Owner.
- Staff can record qualifying POS payments, but cannot read the closing table.
- The proposed `cashbook_day_serialization_guard` triggers are still absent. Source guards that check closed dates exist, but they do not establish the proposed shared day-level lock.

## New nonproduction test
`scripts/cashbook_rls_role_matrix.sql` is a **rollback-only SQL fixture** executed after the existing staged migration in the ephemeral PostgreSQL 17 `bite_cashbook_ci` database. It refuses to run in another database.

The test models separate identities:
- Restaurant A Owner: can record and close the own cashbook day.
- Restaurant A Manager: can inspect closing but cannot close it.
- Restaurant A Staff: can record permissible POS receipts on an open day but cannot inspect closings, backdate into a closed day, or create Owner-only manual cash entries.
- Unrelated authenticated user: cannot insert receipt rows for Restaurant A.
- Restaurant B Owner: cannot view, mutate or close Restaurant A's cashbook; can still close their own restaurant's day.
- Privileged `cashbook_guard_source_day()` remains SECURITY DEFINER for trigger execution, but **direct EXECUTE is denied** to `anon` and `authenticated`.

This extends the existing testing of seven source guards, role-hidden closing visibility, lock contention, cash-only totals, retry idempotency and actual close-versus-write races. All data stays synthetic.

## Explicit limits and next deployment gate
- This test uses a simulated role-membership helper, not real Supabase Auth or a restored production schema. **Green CI does NOT equal staging approval**.
- Set up a separate Supabase staging environment before running real Owner/Manager/Staff auth and multi-tenant integration tests. Do not experiment in the live project, and do not copy customer/payment PII into public CI.
- Check migration compatibility with actual table triggers, views and RLS, then rehearse backup, monitoring and rollback. Only after explicit authorization and successful staging acceptance should `supabase/migrations/20261113212500_cashbook_day_serialization.sql` be considered for production.
- Do not merge the older draft PR #23 blindly: the migration file is already in `main`, but production application is **separate and unapproved**.

No production schema, tables, financial transactions, settlements or cashbook closing rows were modified in this work.
