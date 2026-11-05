# RestaurantOS

A mobile-friendly starter workspace for a multi-restaurant operations platform, beginning with a Rajsamand pilot.

## Current MVP

- Overview dashboard
- Restaurant list and add-restaurant form
- Demo order creation and status progression
- Basic sales and payout reconciliation view
- JSON export/reset for local demo data

## Important limitations

This is a front-end demo only. Data is stored in the current browser using localStorage and is not shared across devices or users. It does not provide secure authentication, a production database, live Zomato/Swiggy APIs, real payment collection, or bank settlement.

Zomato and Swiggy integrations require the relevant platform/technology partner approvals and access. Reconciliation does not reroute marketplace payouts.

## Run locally

Open `index.html` in a modern browser.

## Planned next steps

1. Review the demo UI and pilot workflow.
2. Add backend API, PostgreSQL database, and tenant isolation.
3. Add secure authentication and role-based access.
4. Build partner integration adapters after approvals.
5. Add payment-provider-approved checkout and settlement flow for own-platform orders.
