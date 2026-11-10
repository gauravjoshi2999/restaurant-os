# Architecture and verification coverage

The static GitHub Pages client uses Supabase Auth/Postgres/RLS and trusted Edge Functions. There is no separate privileged Node server in the current repository. Payment credentials and the service key stay on the server.

| Responsibility | Source / authoritative operation |
| --- | --- |
| Customer | `customer.html`, `assets/customer-discovery.js`, `assets/customer-completion.js` |
| Owner/Admin | `index.html`, `assets/owner-core.js`, `assets/workspace-completion.js` |
| PDF receipt | `assets/bite-invoice.js`, `bite_customer_invoice` ownership RPC |
| Delivery | Existing `delivery.html`, bearer handoff + Customer OTP RPCs |
| Price preparation | `bite_prepare_checkout_v2` → existing guarded preparation; server menu/zone prices; unique customer/request key |
| Collection session | `bite-live-create-session`: authenticated owner of intent, snapshot/amount checks, stable provider ID/idempotency key |
| Payment activation | `bite-live-verify-checkout` / signed `cashfree-webhook` → service-only finalizer |
| Refund | Cancellation/rejection queue → Admin decision → separately enabled provider function → trusted status read → service-only accounting RPC |
| Scheduling | Separately enabled `bite-order-maintenance`; custom scheduler secret; no provider refund/payout |
| Storage | `bite-assets` Admin provisioning; public raster menu bucket, private document/bill bucket; restaurant-folder RLS |
| Release | QA on PR/main → exact successful main SHA → public-file package → Pages |

## Feature inventory

| Feature | State | Evidence / limit |
| --- | --- | --- |
| Existing Owner's twelve pages, Menu/Orders/Khata/Cashbook/Expenses/Purchases/Stock/HR/Reports/Settings | WORKING—VERIFIED at the prior core baseline | Prior report `../DEEP_QA_REPORT_20261109.md`; not a claim that every button was freshly authenticated in this release. |
| PIN discovery and filters | FIXED—VERIFIED in staged SQL/model and synthetic UI | New RPC exposes only approved public restaurants; browser fake transport is explicitly labeled. |
| Favourites | FIXED—VERIFIED in staged roles and synthetic UI | Cross-customer read/delete denied; own records retained. |
| Reorder | FIXED—VERIFIED in staged roles and synthetic UI | Current availability/prices; missing/ambiguous historical item matches are not silently substituted. |
| Customer PDF | FIXED—VERIFIED | Actual synthetic PDF downloaded, reopened/rendered; Hindi and ₹ inspected. Raster receipt, not a certified tax invoice. |
| Coupons | FIXED—VERIFIED in staged roles / behavior / UI | Server cap/minimum/limit checks; issued snapshots stay immutable; frontend quote is not trusted pricing. |
| Checkout recovery and price acknowledgement | FIXED—VERIFIED in model/synthetic UI | Does not charge in tests. Fresh signed-in provider journey still required. |
| Contact/address/commission changes during payment | FIXED—VERIFIED in rollback SQL | Paid order retains the prepared snapshot; service finalization survives closure after payment began. |
| Customer Admin controls / deletion request | FIXED—VERIFIED in staged roles | Suspension blocks new checkout, not historical support/delivery. Deletion is a review request, not completed erasure. |
| Categories/featured management | FIXED—VERIFIED in staged roles / synthetic UI | Admin only; frontend publication rules still apply. |
| Core Hindi/English controls | PARTIAL / UI VERIFIED | Explicit vocabulary. Customer/business content and inputs are never auto-translated; some long-form Hinglish remains. |
| Upload pipeline | PARTIAL / STAGED | MIME/size/path validation, RLS and UI present; actual configured-bucket upload/download is not yet an acceptance pass. |
| Provider reconciliation/refunds | PARTIAL / STAGED | Provider requests mocked; financial status/amount/idempotency simulated in rollback SQL. No real refund or bank result. |
| Five-minute deadline / scheduling | PARTIAL / STAGED | SQL state transitions/rollout tested. Scheduler and deployment flags remain inactive pending approval/configuration. |
| Background push / email / SMS receipts | MISSING or NOT TESTED beyond existing foreground realtime/sound | No background delivery receipt is claimed. |
| Email signup/reset delivery | NOT TESTED | Existing reset UI plus trusted recovery update. Needs actual sender configuration and a secure user-controlled acceptance test. |
| Actual marketplace KYC/splits/payouts | EXTERNALLY BLOCKED | An ordinary PG collection is not vendor onboarding or bank payout. |
| Legal/tax/business readiness | EXTERNALLY BLOCKED | Drafts are not approved public policies or compliance certification. |
| Backup restoration / physical Android / staging load | NOT TESTED | No production stress test or paid database branch was created. |

## Repeatability

- `python scripts/check_frontend.py`
- `python scripts/check_owner_structure.py`
- `node --test scripts/*.test.cjs`
- `python scripts/build_static_site.py`
- GitHub CI executes `scripts/browser_smoke.py` against public data and `scripts/browser_completion.py` against isolated synthetic transport. These are distinct test layers.
- `python scripts/prepare_launch_regression.py` emits one rollback-only staged-schema/role probe in ignored `dist/launch-qa`. Review the SQL and use the authorized Supabase SQL operation. It creates no Auth identity and never calls Cashfree. Honor native confirmations.

The SQL probe temporarily uses a retired, unpublished QA parent and existing identities inside a rollback subtransaction. Any simulated verified payment/refund applies only to new temporary orders. The success sentinel rolls back schema and business writes before returning checks. A separate read-back confirmed the new schema was absent and the QA parent remained unpublished. Earlier confirmation expiry and failed intermediate probes are not counted as passes.

The final expanded probe also runs in isolated PostgreSQL via `scripts/run_local_database_regression.mjs`, using read-only live schema metadata exports and wholly synthetic records. Install the test-only `@electric-sql/pglite@0.4.0` under ignored `dist/launch-qa/test-engine`. The runner expects the three catalog JSON snapshots (`catalog-structure.json`, `catalog-routines.json`, `catalog-permissions.json`) from an authorized schema-only export; they are deliberately excluded from the public runtime and repository. Their SHA-256 hashes are recorded in the evidence. The runner rebuilds constraints, functions, RLS and grants; it does not emulate hosted Auth, Storage or provider APIs. All writes are rolled back.

Final expanded source: 22/22 isolated PostgreSQL checks. Earlier revision: 16 live rollback groups. The native confirmation for the expanded live attempt expired, so it is not counted as a pass. Exact evidence is in `RELEASE_EVIDENCE.md`.
