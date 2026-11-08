# Bite — Eat. Repeat.

Bite is an India-focused, full-stack restaurant marketplace connecting Customers, Restaurants and Platform Admins.

## Authoritative product requirements

The current requirements baseline is [Master Product Specification](docs/PRODUCT_BLUEPRINT.md). It was replaced on 2026-11-07 by the user's **Complete Master Prompt — Restaurant Marketplace Website**. It supersedes the older 120-question interview and earlier product decisions. If older code or database structures conflict with the current specification, the current specification wins.

## Three product panels

1. Customer Website
2. Restaurant Owner Dashboard
3. Platform Admin Dashboard

## Current technical foundation

- Repository: `gauravjoshi2999/restaurant-os`
- Frontend: `customer.html` and `index.html`; public delivery handoff page `delivery.html`
- Hosting: GitHub Pages (static frontend)
- Backend/database/auth: Supabase PostgreSQL + Auth + RLS
- Server-side privileged workflows must use trusted backend functions (e.g. Supabase Edge Functions); never expose service-role or payment secrets in browser code.

## Phase 1 progress

See [Phase 1 Database & Access Progress](docs/PHASE_1_DATABASE_ACCESS_PROGRESS.md) and [Master Prompt Implementation Audit](docs/MASTER_PROMPT_IMPLEMENTATION_AUDIT.md) for live database changes, test results and outstanding security work.

## Delivery status

This repository is a development prototype, not a production marketplace. Existing foundations include Supabase authentication, restaurant membership/RLS, restaurants, menus, customer addresses, orders/order items, order status history, financial snapshots, delivery handoff schema/RPCs, customer cancellation/complaint and review foundations.

Not yet production-ready: approved payment aggregator, live collection/split settlement, trusted payment webhooks, automated refunds/payouts, complete restaurant onboarding/admin approval, all business reports, push notification delivery, full support management, and complete browser end-to-end and security testing.

Do not present test data or seeded demo restaurants/orders as real customers or live marketplace activity.

## Initial-release exclusions

Do not expose legacy POS/counter sales, dine-in tables, KOT/KDS, inventory/stock, suppliers/purchases, HR/payroll, customer khata, daily cashbook/closing, multiple branches, Zomato/Swiggy channel integrations, hotel modules, platform delivery fleet or subscriptions as active modules. Legacy database tables may be retained temporarily for data safety; they must not drive the new product UI or business logic.

## Deployment

GitHub Pages workflow: `.github/workflows/deploy.yml`  
Live customer site: https://gauravjoshi2999.github.io/restaurant-os/customer.html  
Live owner/admin app: https://gauravjoshi2999.github.io/restaurant-os/

## Safety

- Never put Supabase service-role/secret keys, database passwords, or payment secrets in browser code.
- Do not collect real customer funds until an approved marketplace provider and required legal/merchant onboarding are complete.
- A successful static deployment or JavaScript syntax check is not proof that payment, order, tenant isolation or other end-to-end workflows work.


## Phase 1 verification snapshot (2026-11-08)

- October 2026 demo dataset for Demo Royal Thali House: 62 clearly flagged simulated orders, 124 items, 314 status events, 62 unpaid demo financial snapshots and 31 demo expenses. No real payments or settlements were recorded.
- Static frontend QA and GitHub Pages deployment workflows passed. See [Phase 1 QA report](docs/PHASE_1_QA_RUN_20261108.md).
- Customer checkout remains intentionally disabled until an approved marketplace payment provider is connected. Production release is not approved while Auth leaked-password protection, owner membership cleanup, customer-only RLS test identity, positive delivery handoff browser test and SECURITY DEFINER review remain open.
