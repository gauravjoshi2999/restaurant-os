# RestaurantOS

RestaurantOS is a multi-restaurant ordering and operations platform prototype, beginning with a Rajsamand pilot.

## Product goal

RestaurantOS is intended to give customers a public website where they can discover participating restaurants, place food orders, and pay online. Each restaurant should manage orders from three channels in one owner dashboard:

1. Orders placed through the RestaurantOS customer website.
2. Orders received through Zomato.
3. Orders received through Swiggy.

For RestaurantOS website orders, the restaurant is responsible for delivery using its own staff or delivery partner. RestaurantOS is not planning to operate its own delivery fleet in the initial model.

The intended payment model is:

- Zomato and Swiggy continue paying each restaurant under that restaurant's existing platform agreement. RestaurantOS will reconcile those payouts; it will not redirect them.
- RestaurantOS website payments are intended to use an appropriately authorized payment-aggregator/marketplace settlement arrangement. The platform may deduct the agreed platform commission and settle the balance to the restaurant.
- The proposed pilot pricing is free Zomato/Swiggy order management, no RestaurantOS website-order commission during the first two pilot months, then a proposed 5% commission on food value. This is a business proposal only; it is not yet implemented in the application or payment system and must be finalized in restaurant agreements.

## Implemented prototype foundation

The current main branch includes:

- Supabase email/password authentication and session restoration.
- Cloud-backed restaurant and order records.
- Restaurant membership roles (owner, manager, staff) and a platform Super Admin foundation.
- Super Admin restaurant onboarding records and onboarding fields.
- Restaurant/order dashboard and order creation UI.
- Multi-item orders with customer name and phone fields.
- Order lifecycle controls and database-recorded status history.
- Manual reconciliation fields for comparing reported platform amounts with bank payouts.
- Responsive layouts intended for desktop and mobile browsers.

Some UI paths and role combinations still require dedicated testing with separate Owner, Manager, and Staff accounts. The current interface is a prototype and should not be treated as a finished restaurant POS.

## Not implemented yet

The following are product milestones, not working production features today:

- Public customer-facing restaurant discovery, menu, cart, checkout, and order tracking website.
- Restaurant menu/catalogue management and inventory.
- Live Zomato and Swiggy order/menu/status integrations. These require the relevant authorized partner/API access and approval.
- Automated order ingestion from external platforms.
- Payment gateway onboarding and collection for RestaurantOS website orders.
- Marketplace payment splitting, commission deduction, refunds, and automated restaurant settlements.
- Restaurant-managed delivery zones, delivery fees, delivery assignment, and delivery status workflow.
- Production-grade reporting, notifications, audit/monitoring, backup and recovery, and complete role-by-role security testing.

## Architecture and safety notes

- Current frontend: a single-page HTML/CSS/JavaScript application in index.html.
- Backend and database: Supabase Auth and PostgreSQL with Row Level Security.
- This is a development prototype, not production-ready software.
- Never put a Supabase service_role key, secret key, database password, or payment-provider secret in browser code.
- Do not collect customer funds into an ordinary company bank account and manually pass them on without an approved legal and payment-provider structure. Obtain professional advice and use an authorized payment/marketplace settlement arrangement.
- Do not promise live Zomato/Swiggy integration until partner access and technical approval are secured.
- Before live launch, complete security review, tenant-isolation tests, backups, monitoring, payment/refund tests, privacy and legal review, and real-device testing.

## Supabase setup

For a brand-new Supabase project, follow SUPABASE_SETUP.md. It documents the SQL files and their required order.

For the existing project, do not rerun the initial schema or migrations just because this documentation changed. The current project has already had the foundation, role/onboarding, security-hardening, order-lifecycle, and multi-item-order SQL applied and verified during development.

Never expose secret credentials. Only the project URL and publishable browser key belong in the frontend.

## Run locally

Serve the repository with a local static web server and open index.html. The deployed GitHub Pages site is available at:

https://gauravjoshi2999.github.io/restaurant-os/
