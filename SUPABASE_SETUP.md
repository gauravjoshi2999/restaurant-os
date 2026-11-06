# RestaurantOS — Supabase setup

The database schema is ready in `supabase/schema.sql`.

## 1. Create the Supabase project
1. Open https://supabase.com/dashboard and sign in.
2. Select **New project** and create an organization if prompted.
3. Project name: `restaurant-os`.
4. Choose a strong database password and save it privately.
5. Choose the Mumbai region if it is offered for your account.
6. Wait until the project finishes provisioning.

## 2. Create the database tables and security policies
1. Open the new project.
2. Go to **SQL Editor** → **New query**.
3. Open this repository file: `supabase/schema.sql`.
4. Copy the complete SQL and paste it into SQL Editor.
5. Click **Run**. Confirm that it completes without errors.

This schema creates profiles, restaurants, restaurant memberships and orders. Row Level Security is enabled so authenticated users only see restaurants they belong to. A restaurant creator is automatically assigned the owner role.

## 3. Get the browser-safe project credentials
1. Open **Project Settings** → **API** (or **API Keys**, depending on dashboard layout).
2. Copy the **Project URL**.
3. Copy the **publishable/anon key** (the browser-safe public key).

Only the Project URL and publishable/anon key are intended for the website. **Never share the database password, service_role key, secret key, or access tokens in chat or put them in frontend code.**

## 4. Send the two public values for website connection
Send the Project URL and publishable/anon key here. They are designed to be used by a browser client; database access is still controlled by the SQL Row Level Security policies.

## Apply the security hardening update

If the project already has the original schema installed, run the new file `supabase/migrations/20261106_security_hardening.sql` in Supabase SQL Editor. It tightens function search paths and execution grants without deleting existing data. Check that the query completes successfully before continuing.

## Current limitations
The current website is an early authenticated pilot workspace, not a production restaurant-management product. The current order creation, restaurant onboarding, and reconciliation screens are limited MVP functions. Do not enter real customer, order, bank, or settlement data yet. Zomato/Swiggy partner integrations and real money movement are not included in this database setup.
