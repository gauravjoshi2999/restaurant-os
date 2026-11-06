# RestaurantOS — Supabase setup

This guide documents the SQL setup sequence for a **brand-new Supabase project**. For the existing development project, do not rerun the setup sequence. The current live schema and migration history have not yet been independently re-verified in this audit; run the read-only preflight in `supabase/phase4_preflight_readonly.sql` before deciding whether any migration is pending.

## 1. Create the Supabase project

1. Open https://supabase.com/dashboard and sign in.
2. Create a new project.
3. Choose a strong database password and store it privately.
4. Choose a region suitable for your users (Mumbai if available and appropriate).
5. Wait until the project finishes provisioning.

## 2. Run the SQL files in order

Open the project → SQL Editor → New query. For a fresh database, run each complete file in the following order, waiting for success before running the next:

1. supabase/schema.sql — core profiles, restaurants, memberships, orders, base RLS and helper functions.
2. supabase/phase2_roles.sql — platform Super Admin foundation and platform-wide policies.
3. Bootstrap the first Super Admin (see below).
4. supabase/phase3_onboarding.sql — Super Admin-only restaurant creation, onboarding fields and deletion policy.
5. supabase/quality_hardening.sql — removes the legacy Owner restaurant-delete policy and adjusts creator membership behavior. Requires Phase 2 and Phase 3.
6. supabase/order_lifecycle.sql — allowed order states, transition enforcement and order status history.
7. supabase/order_details_multi_items.sql — customer details, order items and the create-order-with-items function.
8. supabase/financial_settlement_foundation.sql — financial snapshots, settlement records, settlement line items and platform expenses.
9. supabase/weekly_settlement_drafts.sql — Super Admin-only manual payment-fee/refund reconciliation and seven-day settlement draft generation. It does not transfer money or connect to a payment provider.
10. supabase/automatic_order_financial_snapshots.sql — creates the immutable financial snapshot in the same transaction as every new order. Staff-created orders are limited to zero adjustments; owners/managers/Super Admins can use the snapshot RPC for approved adjustments.\n11. supabase/customer_storefront_foundation.sql — customer addresses, public menu catalog, customer-owned order access, customer checkout RPC, and Realtime order-status/location foundations. Run only after step 10 succeeds.
12. supabase/customer_order_history.sql — secure customer order-history RPC and read access to only the signed-in customer's order items. Run after step 11 succeeds.
13. supabase/customer_checkout_no_otp.sql — customer-entered name/mobile contact profile and checkout RPC that no longer requires SMS/phone OTP. Run after steps 11 and 12 succeed.
14. supabase/phase4_external_channel_owner_guard.sql — installs the first database-level Owner guard for external order entry and status changes. Run after step 13 succeeds.\n15. supabase/phase4_strict_owner_only_guards.sql — tightens the rule so even Super Admin support access does not grant operational order-control rights; only the restaurant Owner (or a trusted server-side service role) can perform these actions. Run after step 14 succeeds.

Do not skip the order. Later SQL files depend on functions or tables created by earlier phases. These scripts are designed to be rerunnable in several places, but do not use rerunning migrations as a substitute for checking the current database state.

## 3. Bootstrap the first Super Admin

1. Register the first administrator through Supabase Auth (or use the intended existing Auth user).
2. In Supabase Dashboard → Authentication → Users, copy that user's UUID.
3. In SQL Editor, run the following after phase2_roles.sql has succeeded. Replace the placeholder with the actual Auth user UUID:

    insert into public.platform_admins (user_id)
    values ('PASTE_AUTH_USER_UUID_HERE')
    on conflict (user_id) do nothing;

4. Only after the insert succeeds, run phase3_onboarding.sql and the remaining files.

Never use an email address in place of the Auth UUID. Do not share passwords, database passwords, access tokens, or secret keys.

## 4. Connect the browser application

1. Open Project Settings → API (or API Keys, depending on dashboard layout).
2. Copy the Project URL.
3. Copy the publishable key (or legacy anon key if that is what the project provides).
4. Configure only those two browser-safe values in the frontend configuration.

Never put the service_role key, secret API key, database password, or payment-provider secret in index.html or any other browser-delivered file.

## 5. Deploy the website

The repository is configured for GitHub Pages deployment through the workflow in .github/workflows/deploy.yml. Push changes to main and check the Actions run before relying on the published site:

https://github.com/gauravjoshi2999/restaurant-os/actions

Live prototype:

https://gauravjoshi2999.github.io/restaurant-os/

## Current scope and limitations

The current site is an authenticated operations prototype. It includes the restaurant/order workspace, role and Super Admin foundations, multi-item order data, order lifecycle history, automatic financial snapshots for newly created orders, and manual reconciliation fields.

The following are not active production capabilities yet:

- Customer checkout UI, saved contact/address management, live payment collection, and complete end-to-end order placement are still being built. The storefront and order-history foundations are in the customer SQL migrations.
- Restaurant-managed delivery zones and delivery workflow (the intended initial model is that each restaurant handles its own delivery; RestaurantOS does not provide a fleet).
- Live Zomato/Swiggy API integration. This requires authorized partner/API access.
- Payment-provider onboarding, marketplace payment collection, automated commission deduction during checkout, automatic payment/refund updates, settlement approval/payout processing, and production P&L reporting. The financial migrations provide a manual, Super Admin-only ledger and seven-day draft generator; they do not transfer money or connect to a payment provider.
- Production-grade security, tenant-isolation, backup, monitoring, and role-by-role testing.

The intended commercial model is that Zomato/Swiggy continue paying restaurants directly under their existing agreements while RestaurantOS reconciles those payouts. RestaurantOS website orders are intended to use an authorized payment-aggregator/marketplace settlement arrangement, with agreed commission and restaurant settlement. These are product/business requirements, not implemented payment flows.

Before processing live orders or money, complete security and legal review, payment-provider approval, restaurant agreements, privacy compliance, refund handling, backups, and end-to-end testing.
