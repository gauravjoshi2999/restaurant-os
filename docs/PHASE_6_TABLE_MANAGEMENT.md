# Phase 6 — Table Management

**Date:** 2026-11-06  
**Status:** Database and UI implementation complete; Tables workspace deployed successfully in GitHub Pages run #167 (commit `31671d2d1481d230aebf8f1df4f0a9ccb840a817`).

## Delivered

- New `restaurant_tables` table with restaurant scope, unique table name per restaurant, area, seating capacity, sort order, active/inactive state and notes.
- `orders.table_id` optional composite foreign key to the same restaurant's table. Historical orders keep the relationship; tables are deactivated rather than deleted.
- New **Tables** workspace: restaurant selector, area filter, available/occupied cards, seat capacity, add/edit and activate/deactivate actions. Owner/Manager can manage setup; Staff can view.
- POS Dine-in order form can optionally assign an available table. Counter and Takeaway do not offer table assignment.
- Occupancy is derived from live orders; Completed, Rejected and Cancelled orders free the table.
- Database trigger serializes table assignment using a transaction advisory lock and rejects a second active order on the same table.
- Database trigger prevents deactivating a table while it has an active order.
- Assignment helper is placed in the non-exposed `private` schema, re-checks authenticated membership, and is callable by authenticated users only.

## Security and verification

- RLS enabled on `restaurant_tables`; authenticated members can read their restaurant's tables. Owner/Manager can create/update; Owner can delete (the order FK protects history). Anonymous table access is revoked.
- Cross-tenant read/write checks were run under an authenticated Owner identity.
- Rollback-only integration test created a table, created a POS Dine-in order assigned to it, and confirmed a second active order on that table is rejected.
- Rollback-only test confirmed an occupied table cannot be deactivated.
- Test transactions were rolled back; follow-up query confirmed no QA rows remain.
- Supabase Security Advisor: 10 authenticated SECURITY DEFINER warnings (same count as before this phase); the new helper is outside the exposed public schema. Existing anon warning remains `list_public_restaurants()`; leaked-password protection remains a dashboard setting.
- Health Advisor returned no findings. Performance Advisor no longer reports unindexed foreign keys for this phase; pre-existing unused-index and multiple-permissive-policy notices remain.
- JavaScript syntax validation passed; all HTML IDs are unique.
- No real Android/browser smoke test has been performed yet.

## Applied Supabase migrations

- `restaurant_table_management`
- `table_aware_pos_order_creation`
- `prevent_deactivating_occupied_tables`
- `secure_table_order_helper_and_indexes`

## Release gate

The Tables workspace is live after successful Pages run #167. The later POS Refunds UI is a separate phase and still awaits its own successful deployment.
