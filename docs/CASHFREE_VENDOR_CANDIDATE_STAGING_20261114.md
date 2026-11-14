# Bite — Cashfree vendor candidate database safety (staging proposal, 14 Nov 2026)

## Scope
This change is **NOT** a deployed production migration. The reviewed SQL proposal lives at `docs/sql/cashfree_vendor_candidates_staging_proposal.sql`. It must not be applied to live Supabase until real independent staging, business approval and secure integration review.

The current live database has 1 internally approved restaurant payout profile, 0 provider-check records, 0 restaurant settlement records, and 7 activated checkout intents at the time of read-only inspection. There is no independently verified restaurant → Cashfree vendor ID mapping.

## Proposed immutable candidate table

`public.bite_cashfree_vendor_candidates` is proposed as an **append-only provider order observation**, never as an approved payout destination.

- Source: linked `restaurant_id`, exact eligible non-demo Own Platform `order_id`, activated `bite_live_checkout_intents.id`.
- Identity: Cashfree `vendor_id` unique globally, so the same ID cannot be claimed by two restaurants.
- Amount: observed non-negative split amount constrained to the trusted matching order payable.
- Status: `mapping_state` can only be `CANDIDATE_ONLY`. There is no Approved/Paid state, bank account, PAN, UTR or transfer operation in this schema.
- Writes: only `service_role` has table SELECT/INSERT; `anon` and `authenticated` privileges explicitly revoked; RLS enabled with no client policy. UPDATE/DELETE are not granted and trigger rejects them.
- Trusted server requirement: a future admin-authenticated backend must independently check Cashfree's actual split response and the initiated order ID, and insert the candidate with the authenticated reviewer's ID. **This PR does not add or enable that write API.**
- This schema by itself cannot prove Cashfree vendor KYC, intended restaurant beneficiary, bank account identity or settlement. It is deliberately unsafe to use it as a payout authorization source.

## Automated QA in isolated PostgreSQL 17

`scripts/cashfree_vendor_candidates_fixture.sql` creates synthetic restaurant/order/intent source records and an isolated service role. `scripts/cashfree_vendor_candidates_db_test.sql` runs rollback-only checks:

1. Service role can insert a candidate tied to a matching paid-activation checkout intent.
2. Duplicate Cashfree vendor IDs across restaurants fail.
3. Foreign restaurant/order/checkout relationships fail.
4. Split amount greater than trusted order amount fails.
5. Demo and POS orders fail.
6. Candidate status cannot be updated to Paid; deletes are blocked.
7. Client roles have no SELECT or INSERT privileges.

These fixtures are **not real Supabase staging**. The CI DB is named `bite_cashbook_ci`, and the tests refuse a different database. They neither invoke Cashfree nor touch bank accounts.

## Production go/no-go

NO-GO for live vendor mapping until:

- Cashfree Easy Split approval and exact `vendor_id` independently verified in the merchant dashboard/API.
- Restaurant identity, beneficiary bank, vendor KYC and signed commission/refund/settlement terms verified with the owner.
- Independent review/approval workflow created and audited; source observations are not approval.
- Real staging Supabase Auth/RLS and Edge Function workflow tests completed, including reused vendor ID across merchants and bank change/revocation.
- Authorized change plan and backup/rollback rehearsal.
- Separately verify provider vendor settlement UTR against the actual restaurant bank credit for any claimed payout.

No actual vendor ID, account number, PAN or financial provider secret is recorded in this PR.
