# Bite Cashbook — staging race and rollback readiness (14 November 2026)

## What was actually verified (READ ONLY production)

Project: `wedbgpybbgsszcmffoha`. Read-only SQL catalog and aggregate ledger checks found:

- All seven cashbook source tables exist. Their business-date columns are `date` typed and their tables have RLS enabled.
- `cashbook_day_serialization_guard` trigger instances: **0 of 7**. `cashbook_guard_source_day` function: absent. This migration is not applied to the production database.
- Existing guard triggers are present; their functions check already-closed dates but do **not** share the proposed `bite.cashbook.day.v1` transaction advisory lock.
- There are currently **0 closed days** in `restaurant_cashbook_closings`. This is a snapshot, not a statement about future data or a promise of production correctness.
- The staged migration `supabase/migrations/20261113212500_cashbook_day_serialization.sql` modifies existing closing trigger/RPC definitions, and adds seven new triggers. It does not create new business payment rows.

## Additional non-production QA

`scripts/cashbook_close_vs_write_smoke.sh` runs **only** when `CI=true`, `PGDATABASE=bite_cashbook_ci` and `PGHOST=localhost`. Two actual PostgreSQL sessions exercise the existing staged migration and closing RPC on the ephemeral fixture.

1. **Close first:** while the closing transaction holds the restaurant/day advisory lock, an incoming manual cash entry must time out. After the close commits, that entry must be rejected because the day is closed.
2. **Write first:** while a cash entry holds the lock, closing must time out. After the entry commits, the next closing must include the incoming ₹7 receipt in the physical cash total, i.e. ₹100 opening + ₹7 = ₹107 expected.
3. Old synthetic regression suites still verify seven source guards, RLS-hidden staff, direct forged totals, retry idempotency, cash vs UPI, and date immutability.

The CI fixture is **not** a full Supabase staging clone. This test proves the exercised race order *only in that fixture*, not real production readiness. Other source types and migration interactions require a real staging environment.

`scripts/cashbook_release_preflight_readonly.sql` is a `BEGIN TRANSACTION READ ONLY` report of seven schemas/triggers, existing function fingerprints and aggregated historical closing drift. It makes no changes. CI also executes it in the fixture.

## Safe rollout process — requires a separate explicit authorization

1. **Create an isolated Supabase staging project** with the same extensions, auth roles, existing triggers, and a sanitized copy of the seven source schemas and related views. Do not use production payment or customer data for experiments.
2. Run the read-only preflight. Confirm all seven date types and RLS, existing trigger interactions, view `security_invoker` setting, zero or reconciled historical closing drift, and function definitions. **Stop on schema differences.**
3. Before migration, securely capture a verified database backup/restore point and exact originals from `pg_get_functiondef` for `public.calculate_cashbook_closing()` and `public.close_restaurant_cashbook_day(uuid,date,numeric,numeric,text)`, including privileges, triggers and schema migration history. Do not publish backups or financial data in GitHub.
4. Apply the staged migration **only in staging**, check all seven guard triggers exist and are enabled, `SECURITY DEFINER` guard function has `search_path=''` and no anonymous or authenticated direct EXECUTE, and validate Owner/Manager/Staff tenant access.
5. Exercise **all seven source write paths** and two-session contention on staging: POS receipt, refund, expense, purchase, employee payment, khata collection and manual entry. Test INSERT/UPDATE/DELETE, cross-day moves, retries and closed-day exceptions. Verify no lost payments or deadlocks under the existing order-row/payment guards. Include real Owner UI/Android review and confirm.
6. Obtain explicit release approval, a quiet maintenance window, named operator/backup, monitored rollback checkpoint and a written financial reconciliation plan. Only then consider production DDL.
7. After approved production migration, rerun the preflight and monitoring, inspect the 7 triggers and payment/ledger error rates, confirm no unexplained pending transactions, and test only a controlled authorized non-destructive flow.

## Rollback safety

**Do not use a blind “drop seven triggers” rollback** — the proposed migration also replaces the closing calculation trigger function and the closing RPC. Simply dropping triggers would leave partially migrated semantics. A safe rollback requires:

- Pausing new closing operations and incident triage.
- Restoring both original function definitions, prior `EXECUTE` grants and dependency state from predeployment captures, alongside removing only migration-created triggers and function; or a fully tested database point-in-time restore if appropriate, after reconciling any post-migration orders/payment activity.
- Rechecking existing guard trigger definitions and `restaurant_cashbook_closings` totals, and preserving all committed business transactions.
- Recording the migration history result and exact rollback commit. Avoid restoring an older database snapshot over new live payments without a reconciliation plan.

**Current GO/NO-GO:** NO-GO for production application until real staging acceptance, backup/rollback rehearsal and explicit owner authorization. This PR only adds read-only preflight material and extra CI tests. It changes neither runtime frontends nor live SQL/database rows.
