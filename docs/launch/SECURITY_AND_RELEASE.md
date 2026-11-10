# Security, release and recovery

## Boundaries

- Public key only in browser; service/payment secrets remain in trusted function environment.
- New tables enable RLS and explicitly revoke hosted default API write grants before granting the intended operations.
- Customer records use exact auth identity; Owner records use restaurant membership. Platform Admin cannot inherit operational Owner access through a legacy membership.
- Coupon management, customer status, refund decisions and metrics use guarded RPCs. Service-only activation/refund/maintenance functions revoke anon/authenticated execution.
- Provider amount/currency/reference checks, stable IDs, signed callbacks and atomic finalization remain authoritative. SDK/redirect text does not mark a payment paid.
- New control changes include restricted before/after audit records. Private upload path ownership, raster MIME restrictions and immutable UUID filenames are enforced; no broad upsert policy is granted.
- Prior security advisor warnings and disabled leaked-password protection are recorded in the earlier deep QA report. This release does not certify every historical SECURITY DEFINER function, actual backup restoration or all Auth settings.

## Approval and release sequence

The owner's execution brief requires explicit approval before production deployment, destructive changes, real financial edits, charges/refunds/payouts, external messages or public legal claims. This branch is prepared for review; do not treat a passing PR as deployment approval.

After the exact release is approved:
1. Confirm a recoverable Supabase backup/snapshot and the retention/restore procedure; perform the restore drill in an approved isolated environment. No production stress test or paid development branch is implicitly authorized.
2. Review/apply only `supabase/migrations/20261109201541_bite_launch_completion.sql`. It is additive; preserve old tables/history and do not replay unrelated prototype SQL. Record the actual migration version.
3. Deploy JWT-protected `bite-live-create-session`, `bite-live-verify-checkout`, `bite-cashfree-operations`, `bite-assets`. Existing signed webhook remains signature-protected. Deploy `bite-order-maintenance` with custom-secret authentication and JWT verification disabled only for this scheduler endpoint.
4. Keep `BITE_PROVIDER_REFUNDS_ENABLED` and `BITE_MAINTENANCE_ENABLED` unset/false. Create the two restricted upload buckets through the Admin Storage API action; test own/foreign access and signed downloads using authorized test records. Do not upload real identity/bank documents for a test.
5. Complete PR QA, merge the approved commit, and verify the new main QA and Pages run use the exact resulting commit. The deployment workflow refuses a failed/unverified main commit and publishes `dist/site`, excluding SQL, tests, docs and fixture pages.
6. Complete Customer → Owner → Admin acceptance using dedicated authorized test accounts and sandbox payments. The current UI fixture transport is not that acceptance.
7. Test real Auth recovery delivery and approved merchant/provider integrations without sharing credentials in chat. A user controls credential entry and consequential financial actions.
8. Only enable a maintenance schedule after separate operational approval, secret configuration and a healthy heartbeat. Admin enabling the five-minute deadline then applies only to future paid orders. Refund review is still separate from actual provider execution.

## Scheduler setup after approval

Use the documented [Supabase schedule-functions workflow](https://supabase.com/docs/guides/functions/schedule-functions) with Cron/pg_net and Vault, or an approved trusted HTTPS scheduler. Run once per minute. Keep the maintenance URL and random bearer secret in trusted configuration/Vault; never commit the token or put it in the public client. Call only `POST /functions/v1/bite-order-maintenance` with the dedicated secret. Confirm `last_maintenance_at` before enabling deadlines. The worker bounds provider lookups, never treats a timeout/404/PAID response as expired, and never issues a refund or payout.

## Rollback

- Frontend/Edge rollback: restore the previous verified runtime source and functions; retain the new additive schema/data. Disable maintenance and new checkout entrypoints if a critical defect appears.
- Do not drop coupon, refund, audit or provider-evidence tables after use. Do not undo a provider-confirmed refund by reversing a database migration. Financial/provider reconciliation is a separate approved incident process.
- Record the failing commit, affected provider/order reference, actual impact and corrective commit. No secrets/OTP/private contact data in public incidents or logs.
- The full code tree and deployment commit must agree. Manual redeployment accepts only an approved full SHA with successful main QA.

## Authentication setup

The browser SDK is pinned to the registry version checked for this release. Existing email/password and recovery-session flows remain. Supabase documents its built-in sender as development-oriented and restricted; production recovery needs a verified sender/custom SMTP and allowed redirect URLs. Do not disable confirmation or change a user's password as a workaround. Configure credentials in the provider dashboard, test one delivered reset in a user-controlled account, expired links and session recovery, then record the result.

References: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [password recovery](https://supabase.com/docs/guides/auth/passwords), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [private/public buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
