# RestaurantOS — Supabase setup

This guide is for a **brand-new Supabase project**. The existing development project already has these SQL phases applied and verified. If you are working on that existing project, do not rerun the setup sequence just because this guide was updated.

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
8. supabase/financial_settlement_foundation.sql — financial snapshots, settlement records, settlement line items and platform expenses. This is a development foundation only; it does not collect payments or execute payouts.

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

The current site is an authenticated operations prototype. It includes the restaurant/order workspace, role and Super Admin foundations, multi-item order data, order lifecycle history, and manual reconciliation fields.

The following are not active production capabilities yet:

- Public customer-facing restaurant discovery, menu, checkout, and order tracking.
- Restaurant-managed delivery zones and delivery workflow (the intended initial model is that each restaurant handles its own delivery; RestaurantOS does not provide a fleet).
- Live Zomato/Swiggy API integration. This requires authorized partner/API access.
- Payment-provider onboarding, marketplace payment collection, automated commission deduction during checkout, refunds, settlement creation/approval/payout processing, and production P&L reporting. The financial-settlement SQL migration creates the initial record structure only; it must be applied and tested separately.
- Production-grade security, tenant-isolation, backup, monitoring, and role-by-role testing.

The intended commercial model is that Zomato/Swiggy continue paying restaurants directly under their existing agreements while RestaurantOS reconciles those payouts. RestaurantOS website orders are intended to use an authorized payment-aggregator/marketplace settlement arrangement, with agreed commission and restaurant settlement. These are product/business requirements, not implemented payment flows.

Before processing live orders or money, complete security and legal review, payment-provider approval, restaurant agreements, privacy compliance, refund handling, backups, and end-to-end testing.
