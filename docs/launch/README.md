# Bite — controlled launch dossier

Date: 10 November 2026 (India). Scope: existing restaurant-os project, Rajsamand / PIN 313324. The attached execution brief is retained in `../ULTIMATE_MASTER_PROMPT.md`.

**Current decision: NO-GO for an unrestricted commercial launch.** This branch contains substantive implementation and test evidence; it is not a certification of merchant approval, legal compliance, delivered recovery email, bank credit or a newly authenticated paid three-panel journey. Production deployment requires the owner's explicit approval under the execution brief. No production migration, new Edge deployment, refund, payout or bank-record adjustment was made for this branch.

## What this release adds

- PIN-aware discovery, rating/food/open filters and price/delivery sorting; database-managed categories and featured restaurants.
- Private favourites, current-menu reorder, Customer PDF receipts and profile editing.
- Restaurant-funded and platform-funded coupons, server calculation, reservation limits and immutable financial snapshots.
- Request-key checkout idempotency, reload recovery, locked pending carts, changed-price acknowledgement, and immutable contact/address/commission snapshots.
- Admin customer directory, ordering suspension/reactivation, audited controls and account-deletion requests.
- Owner menu photo / private document / expense bill attachment interfaces; tenant Storage policies and Admin bucket provisioning/document inspection.
- Admin provider collection/settlement inspection, refund review queue, explicit approval/execution, provider-confirmed refund accounting and retry protection.
- Five-minute unanswered-order cancellation with rollout cutoff, deadline enforcement, scheduler heartbeat and refund-review queue; expiry of provably unstarted/terminal provider checkouts.
- Admin metrics with explicit missing-cost/funnel coverage; platform-funded discounts preserved in the modeled restaurant share.
- Hindi/English core navigation and control vocabulary; user data and input values are preserved. Long-form dynamic help and errors retain existing Hinglish where not in the explicit vocabulary.
- An exact-commit QA deployment gate and a public-runtime-only package; private entrypoints have noindex metadata.

## Read in this order

1. [Test evidence and feature coverage](ARCHITECTURE_AND_COVERAGE.md).
2. [Payment and settlement reconciliation](PAYMENTS_AND_RECONCILIATION.md).
3. [Risk register](RISK_REGISTER.md).
4. [Security, deployment, backup and rollback](SECURITY_AND_RELEASE.md).
5. [Operations and restaurant training](OPERATIONS.md).
6. [Metrics, pilot acquisition and 30/60/90-day plan](BUSINESS_PLAN.md).
7. [Unapproved legal drafts](LEGAL_DRAFTS.md) and [required owner decisions](OWNER_INPUTS.md).

## Launch gates

| Gate | Assessment before approved deployment |
| --- | --- |
| Customer account login and delivered recovery email | NOT TESTED in a fresh real account. Sender/redirect configuration must be verified. |
| Discovery, availability, menu and cart | Existing public journey covered; new controls also exercised with isolated synthetic transport and rollback SQL. |
| Server pricing, duplicate prevention, callback ownership and verification | Implemented core plus staged protections; real provider acceptance of the new release is not certified. |
| Correct Owner inbox/status and secure handoff | Prior implemented core has database role tests; fresh authenticated cross-panel acceptance remains required. |
| Tenant isolation and Admin boundaries | Existing checks plus staged role/RLS regression. This is not a blanket audit of every historical object. |
| Refunds and marketplace settlement/payouts | Refund controls staged and mocked/SQL tested. Actual refund, Easy Split/vendor KYC, bank settlement and restaurant payout require external verification/approval. |
| Customer support | Existing private tickets/Admin replies; internal playbook prepared. Public grievance details and staffing must be approved. |
| Restaurant/legal readiness | EXTERNALLY BLOCKED on business disclosures, valid licences, provider agreement and tax/invoice review. |
| Mobile | Public browser checks plus synthetic three-panel UI tests; physical Android and newly authenticated roles are not certified. |
| Deployment, monitoring and recovery | CI/release controls staged; full backup restoration and production monitoring acceptance not performed. |
| No critical unresolved launch risk | Fails until the external and authenticated/provider gates above pass. |

A code release can be approved independently of a market launch. Keeping real-refund and maintenance flags disabled does not convert them into operationally active services.
