# Bite — Trusted cancellation automatic refund (staged rollout)

**Current safe deployment policy:** OFF until audited production activation.
This code does not retroactively approve or execute any pre-existing refund.

## Rules
- No separate Super Admin approval for a **new** valid Customer cancellation **before** restaurant acceptance, a Restaurant rejection while the order is Received, or an Owner-approved cancellation request. These originate in protected database transitions, not client-provided reasons.
- Food already delivered, completed, disputed, suspicious, partial refunds, or anything over the configured cap remains manual. Existing refund jobs remain unchanged.
- Initial full-refund cap: ₹2,000; payment must be fully verified and matched to the immutable live checkout record.
- Provider GET confirms the original order PAID. GET by refund ID and GET all refunds must exclude existing/competing refunds before a single POST is claimed. A unique, stable job ID is the provider idempotency key.
- A retry after claim only **checks** provider status. It never blindly repeats the refund POST. Refund reaches 'succeeded' in Bite only on provider SUCCESS.
- Neither webhook nor browser is allowed to mark a provider refund as successful without server-side evidence.

## Three rollout gates (must all pass)
1. PR CI, public page browser QA, and dedicated automatic-refund regression tests.
2. Apply `supabase/patch_20261115_trusted_auto_refunds.sql` through a reviewed Supabase migration. Deploy `bite-auto-refund` Edge Function with `verify_jwt=false`: the function validates its own user Bearer JWT through Supabase Auth for single-order calls or checks the private maintenance secret for scheduled calls. Confirm this server-only setup; never publish the maintenance secret.
3. Add exactly the same private `BITE_MAINTENANCE_SECRET` to Supabase Edge Function environment and GitHub Actions repository secrets; the scheduled workflow runs every five minutes. Initially, `auto_refunds_enabled` must be false. After a sandbox/controlled live cancellation and provider check, enable using a privileged migration/SQL:
   `update public.bite_operations_config set auto_refunds_enabled=true,updated_at=now() where id=true;`
   Do not activate without a tested provider response, owner policy acceptance, refund fee/settlement reconciliation and correct retry guarantees.

## Important limitations
- A customer cancellation immediately triggers a best-effort worker call; the scheduled runner is needed for processing after the customer closes the browser and for restaurant-side cancellations. GitHub Actions scheduled workflows may have minor delays.
- Historical approved ₹1 refunds and any ambiguous refunds are **NOT** auto-processed or backfilled by this rollout. Use existing read-only Cashfree verification first.
- No customer bank credit is promised at the moment of cancellation.
- Pause promptly if Cashfree evidence is inconsistent, declined, uncertain or a competing refund is detected. Never rotate refund IDs or double-submit.
