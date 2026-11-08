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

## Additional Phase 1 work

- Default marketplace commission is now 10.00%, stored in a single platform settings row and protected by RLS for Platform Admin access only.
- Restaurants can optionally have an admin-controlled commission override; non-admin attempts to modify it are blocked at the database layer.
- Financial snapshots now use the configured commission rate instead of the legacy hardcoded 18%.
- Restaurant discovery and checkout both require explicit Admin approval.
- Verified: exactly 5 currently approved + active + published restaurants are returned by discovery; checkout still blocks order creation while no payment provider is configured.
- Added migrations: `20261108090000_bite_phase1_configurable_commission.sql`, `20261108091000_bite_phase1_enforce_approved_restaurant_discovery.sql`.


## Owner workspace alignment

- Owner login now refuses ambiguous multi-restaurant assignments instead of choosing the first restaurant.
- Initial-version owner navigation is restricted to Overview, Orders, Menu, Expenses, Reports and Settings. Legacy POS, tables, khata, cashbook, purchases, inventory and HR remain stored but are hidden from the Owner workspace.
- Manager/staff login is not enabled in this MVP because the supplied Master Prompt defines one Owner Account per Restaurant.
- UI source update commit: `1daf47af2aa2d24fa39b751eaf2c30b397a6e37d`. Deployment workflow is running.


## 2026-11-08 QA evidence

See [Phase 1 QA Run](PHASE_1_QA_RUN_20261108.md) for live SQL test results, demo dataset counts, CI/deployment results and remaining production blockers. The month of simulated data is marked with `is_demo=true` in orders, order financials and expenses. Demo financials are unpaid and excluded from settlement eligibility.

- Follow-up security check: public delivery-area RPC now requires `onboarding_status='approved'`; direct anon access to handoff table is denied and invalid handoff token yields no record.

- Admin approval UI now writes the actual `onboarding_status` and review audit columns; approval permission test passed for Admin and was denied for Owner.
- Owner route scope and marketplace-only order/report filtering are enforced in the frontend; legacy POS creation is blocked.
- Legacy owner invitation Edge Function version 3 now rejects cross-restaurant Owner assignment and Platform Admin reuse.


## Marketplace scope enforcement — 2026-11-08

- Applied migration `20261108034400_bite_phase1_disable_legacy_manual_order_rpcs.sql`.
- Revoked `anon` and `authenticated` execution on the legacy `create_order_with_items`, `create_pos_order_with_balance_action`, and `create_pos_order_with_payment` RPCs; `service_role` retains controlled execution.
- Verified live privileges: all three RPCs return `anon_execute=false`, `authenticated_execute=false`, `service_role_execute=true`.
- This closes direct API access to legacy manual/POS order creation, matching the initial marketplace exclusions. Existing POS tables and historical records remain preserved.
- Security Advisor authenticated-callable SECURITY DEFINER finding count reduced from 24 to 23. Remaining findings still require per-function review; this does not mean the whole security review is complete.
