# RestaurantOS

A mobile-friendly multi-restaurant operations platform prototype, starting with a Rajsamand pilot.

## Current implemented foundation

- Supabase Auth email/password login and session restore
- Supabase PostgreSQL cloud storage for restaurants and orders
- Row Level Security (RLS) policies for restaurant membership and tenant-scoped data
- Restaurant creator is automatically added as the restaurant owner
- Owner, manager, and staff membership roles exist in the database foundation
- Restaurant and order dashboard, order status controls, and manual payout reconciliation UI

## Important limitations

- Role-specific dashboard permissions and the platform Super Admin role are not implemented yet.
- Restaurant onboarding approval, staff invitations, menu management, inventory, audit logs, and full tenant-isolation testing are still pending.
- Zomato/Swiggy live order APIs are not connected. Any such integration requires the relevant platform/technology partner approval and access.
- Reconciliation is manual. Marketplace payouts are not rerouted; they continue according to the restaurant's platform agreement.
- No customer payment collection or automatic restaurant settlement is implemented.
- This is a development prototype, not production-ready software. Complete security review, backups, monitoring, and real-device testing are required before onboarding live restaurants.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor for a fresh project.
3. Configure the project URL and publishable key in `index.html`.
4. Enable the desired email confirmation settings in Supabase Auth.
5. Deploy the repository through GitHub Pages.

Never put the Supabase `service_role` key or database password in browser code.

## Run locally

Serve the repository with a local static web server and open `index.html`. A deployed GitHub Pages build is also available from the repository's Pages settings.
