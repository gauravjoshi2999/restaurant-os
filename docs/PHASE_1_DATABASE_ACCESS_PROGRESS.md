# Bite Phase 1 — Database and Access Foundation

Date: 2026-11-08

## Applied

1. Added an explicit restaurant onboarding lifecycle: pending, approved, rejected, suspended.
2. Preserved all existing restaurant data. Previously active and published restaurants were marked approved; the rest remain pending.
3. Added database-level protection so only a Platform Admin can approve, reject, suspend, or publish a restaurant.
4. Public restaurant discovery now requires active + published + approved.
5. Removed default PUBLIC execution on the public restaurant-approval helper; explicit anon/authenticated/service-role grants remain.

## Live verification

- Supabase project is ACTIVE_HEALTHY on PostgreSQL 17.
- Live onboarding state after migration: 5 approved, 5 pending.
- Non-admin owner update attempt against approval state was rejected by the database (SQLSTATE 42501); test transaction rolled back.
- The two migrations are recorded in Supabase migration history.

## Important outstanding issues

- One existing restaurant has two distinct owner memberships; resolve ownership before enforcing the one-owner rule.
- 5 anon and 24 authenticated SECURITY DEFINER functions still need per-function review.
- Delivery-handoff table has RLS but no direct policies; confirm RPC-only access is correctly restricted.
- Leaked-password protection remains disabled in Supabase Auth and must be enabled in Dashboard.
- Existing UI still exposes excluded legacy modules; frontend refactor is pending.
- This phase is not production-complete until all role journeys and cross-tenant negative tests pass.

## Migration files

- `supabase/20261108083000_bite_phase1_restaurant_onboarding_guard.sql`
- `supabase/20261108083500_bite_phase1_public_function_grants.sql`

## Next

Continue Phase 1 by auditing and hardening role resolution, one-restaurant ownership, RLS and SECURITY DEFINER RPCs. Then proceed to the customer storefront and restaurant onboarding screens.
