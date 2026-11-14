# Bite Cashbook — session-safe closing and production guard audit (2026-11-14)

## Read-only production database check

Supabase project `wedbgpybbgsszcmffoha` was inspected using a SELECT-only catalog query. Results:
- `cashbook_day_serialization_guard` triggers in `public`: **0** (expected **7** after the proposed migration).
- `public.cashbook_guard_source_day()` functions: **0**.
- `close_restaurant_cashbook_day` function definitions containing `pg_advisory_xact_lock`: **0**.

Therefore the review/staging migration `supabase/migrations/20261113212500_cashbook_day_serialization.sql` is **not verified as applied in production**. CI applies it only to an ephemeral PostgreSQL 17 fixture. A green synthetic CI does not prove production source-write serialization or closed-day accounting immutability.

**Do not apply this migration automatically to production.** It adds privileged triggers to seven financial sources and must undergo approved staging tests, observed locking/concurrent write tests, a deployment window, backups/rollback planning, financial owner acceptance, and post-application catalog verification.

## Current frontend hardening

- Capture the authenticated User ID, role, restaurant workspace, restaurant selector and India-local date before asynchronous cashbook operations.
- Drop outdated results if that identity or selected date changes during cashbook load, review, final verification or save.
- Bind a confirmed cashbook review to the specific initiating Owner, not just restaurant and date; another Owner cannot submit that review.
- Prevent double-click manual-entry inserts while a save is in flight. An uncertain network response asks the Owner to refresh and check before retrying, rather than claiming that the entry definitely failed.
- Keep the server's owner authorization, SQL RLS and concurrency protection as the authoritative boundary. This frontend check does not replace server-side locking or an idempotent manual-entry API.
- No real financial transactions, Supabase DDL, payments, settlement, refunds or business records were changed for this work.

## Release gates

1. GitHub PR QA: Node async races, existing frontend/Chromium and ephemeral PostgreSQL closing/concurrency suites.
2. Merge only green CI, then confirm exact main commit QA and GitHub Pages deploy.
3. Authenticated Android owner and manager test: same date, two accounts, review and confirm, manual entry double-tap and network interruption.
4. Separate approved production migration rollout and verification before representing Cashbook as fully safe for real financial day closing.

**Explicit remaining risk:** Concurrent source writes against live closing still need the 7-source server migration. This frontend PR must not be described as resolving that blocker.
