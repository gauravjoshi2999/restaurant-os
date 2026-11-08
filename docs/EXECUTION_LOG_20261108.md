# BITE execution log — 8 November 2026

This log records changes actually applied during the 8 November hardening pass. It does not certify the marketplace as production-ready.

## Changes applied

- Corrected the Owner Overview online-order KPI: it now renders the numeric count instead of reading `.length` from a number.
- Corrected Owner and Super Admin sales metrics: only verified-paid, non-demo BITE financial snapshots contribute to sales, and demo orders do not inflate live-order counts.
- Routed the 62 October `Bite Demo Simulation` orders into the BITE website order board for workflow testing, with a visible `DEMO ONLY` label; they remain excluded from live metrics and settlement totals.
- Restricted realtime new-order alerts to BITE website orders only; legacy aggregator channels no longer trigger Owner alerts.
- Corrected `place_customer_order` financial snapshot creation. The legacy 18% literal was replaced with the restaurant's configured commission override or the platform default (10%). The function now calculates the commission from that rate.
- Added a customer forgot-password entry point using Supabase Auth `resetPasswordForEmail`, recovery-session handling using `PASSWORD_RECOVERY`, password confirmation, and `updateUser({ password })`. The recovery screen no longer requires the customer to re-enter an email after returning from the secure reset link.
- Added duplicate Owner assignment checks to both live Owner provisioning Edge Functions:
  - `create-restaurant-owner-login` version 7
  - `invite-restaurant-owner` version 4
- Added a frontend Owner access guard that blocks accounts linked to multiple restaurants and restaurants with more than one Owner assignment.
- Added a database trigger that blocks a second Owner assignment to the same restaurant, rejects Platform Admin accounts being newly assigned as restaurant Owners, and serializes concurrent Owner assignments with a transaction-scoped advisory lock. Existing ambiguous membership rows were deliberately not reassigned or deleted.
- Version-controlled the live Owner provisioning Edge Function sources and the database migrations in `supabase/`.

## Live database verification performed

- 40/40 public tables have RLS enabled.
- The commission function no longer contains the old 18% literal; the platform default is 10.00%.
- A conflicting Owner insert was rejected by the database trigger; the test transaction left the existing membership count unchanged. The same-owner idempotent update was also accepted, and the concurrency-safe trigger re-test passed.
- A Platform Admin account could not be inserted as a restaurant Owner; the test transaction was rolled back.
- Owner restaurant profile update was permitted, while an Owner attempt to change the protected commission rate was rejected; transaction rolled back.
- Checkout was exercised with a valid customer, saved address, restaurant and menu item. The unconfigured payment provider guard rejected the checkout before an order was created; transaction rolled back.
- Delivery handoff positive database journey passed: Owner creates link, customer-only OTP lookup, bearer-link lookup, Owner marks Handed Over, OTP confirmation marks the order Completed and consumes the token. All test rows were rolled back.
- Delivery OTP negative journey passed: five wrong attempts were counted and the sixth attempt was blocked. All test rows were rolled back.
- All inline JavaScript in `customer.html`, `index.html`, and `delivery.html` parsed successfully in a V8 syntax check. Static regression assertions passed for password recovery, Owner mapping, KPI calculations, demo labelling, BITE-only alerts and secret-key absence.
- Chromium smoke coverage was extended for the customer forgot-password entry and the mobile Owner/Admin sign-in gate; the latest GitHub Actions result still needs to be checked before calling those browser tests passed.
- Static QA and Chromium smoke scripts were extended to cover password recovery entry and Owner KPI / Owner mapping regressions. Their latest GitHub Actions run must be checked separately; a syntax check is not a browser E2E pass.

## Data integrity deliberately preserved

Existing Owner membership conflicts remain in the database because the intended account-to-restaurant mapping cannot be inferred safely. New conflicting assignments are blocked at the database, Edge Function and login layers. No historical membership or customer data was deleted.

## Release safety

Cashfree merchant review / marketplace split-settlement approval is external to this repository. Checkout remains fail-closed; no payment success, order creation, refund or settlement is simulated. The Supabase Auth leaked-password protection setting is still reported disabled by Security Advisor and must be enabled in the Supabase Auth security settings before production acceptance.
