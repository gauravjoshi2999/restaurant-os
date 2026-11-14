# Bite — Customer Auth Recovery & Account Data Isolation
Date: 2026-11-14

## Source-backed findings
1. The existing `Forgot password` handler fired the email-reset API directly inside the login form, while the login password field stayed visible. The user had requested an email-only reset screen.
2. `openAccountView`, `loadAccountAddresses` and `loadCustomerSupportTickets` awaited Supabase responses without checking whether the customer had logged out or changed accounts before writing profile, saved address or support data into the page.
3. The prior P0 My Orders fix already protects delayed order responses, but Account UI needed equivalent invalidation.
4. Real Supabase email sending and provider rate limits cannot be certified with unauthenticated browser fixtures.

## Changes
- Added an explicit `reset-request` auth mode, displaying **only the email input**, a Send reset link action and Back to login.
- Kept the existing Supabase `resetPasswordForEmail` flow with correct redirect path. The request uses just email; no password is required to request a link. Error messages distinguish invalid email and provider rate limits without promising a mail was delivered.
- Supabase `PASSWORD_RECOVERY` event still opens the separate new-password/confirmation form; normal login and signup remain distinct.
- Added a customer account view generation counter and user ID checks to discard late profile/address/support responses when logout, account switch or a newer account request supersedes them.
- On an account transition, clear old profile/address/support/order DOM, local address arrays, and outstanding checkout/order/account requests. Existing Supabase RLS and tenant checks remain authoritative; client guards add defense-in-depth rather than replacing database security.

## Automated coverage
- `scripts/customer_reset_account_async.test.cjs` executes the actual reset renderer and email request function, including invalid input, mocked success and mocked rate-limit errors. It also simulates late address and support results after logout.
- `scripts/browser_smoke.py` opens Forgot password in Chromium, verifies the password fields are hidden, validates empty email and uses a **local mock** for the reset endpoint. No real reset mail is sent by CI.
- Existing `scripts/customer_p0_async_races.test.cjs` now asserts account and address data is cleared along with order state on logout.
- Full Node, Chromium, Python static guards and ephemeral PostgreSQL regression must pass before merge.

## Constraints / not claimed
- No modification to Supabase Auth settings, SMTP provider, rate limits or customer records; no real password/email request sent from QA.
- No Cashfree, online checkout, refunds, split settlement, Owner/Admin, delivery OTP or database schema changes.
- Actual email delivery, expired/tampered recovery links, password reset on a real account and physical Android/iPhone session retention need separately authorized live/staging tests.
- QA success here does **not** certify final marketplace launch or production payments.
