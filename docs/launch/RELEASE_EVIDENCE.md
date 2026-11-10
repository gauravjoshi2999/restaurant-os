# Release evidence — 10 November 2026 (Asia/Kolkata)

Status: source prepared for review, not deployed. Market launch remains NO-GO until the gates in README and OWNER_INPUTS are met. Base main: `811122e312fcb27cc72f87130a70926c1755cf13`.

| Layer | Result | Practical limit |
| --- | --- | --- |
| Node behavior suites | 61/61 pass, zero skipped | Mocked provider/network responses; no real charge, refund or payout |
| Frontend/Owner structure checks | Pass | Parsing, wiring and guard checks do not replace signed-in acceptance |
| All external asset JavaScript | Node syntax pass | Not a complete browser execution proof |
| Workflow YAML / public package | Parse/build pass | Only runtime files packaged; QA fixtures/SQL/docs excluded |
| Expanded database probe | 22/22 pass in isolated PGlite 0.4.0 PostgreSQL | Current schema metadata plus wholly synthetic records; not hosted Auth/Storage acceptance |
| Earlier live rollback probe | 16 groups passed on an earlier revision | Final expanded native confirmation expired; no expanded live pass claimed |
| Browser, public baseline | Restaurants/menu/cart inspected | Existing backend; new PIN RPC not deployed |
| Browser, synthetic UI | Customer/Owner/Admin interactions inspected; PDF downloaded/rendered | Explicit QA transport; no real accounts, payment, upload or bank lookup |
| Final mobile/recovery recheck | 390px preview inspected; pending checkout restores ₹155 and locks original contact/address | Synthetic fixture; screenshots below |
| Fresh email/reset/provider/Storage/scheduler/bank acceptance | Not performed | Needs approved configuration, controlled accounts and separate financial authorization |

`local-database-evidence.json` contains case names, catalog hashes and rollback proof: staged schema absent, QA parent private, zero remaining test orders. It contains no customer contact or payment credential. Production was not migrated or redeployed during these changes. The old ₹174 order was inspected read-only in the database; actual provider settlement or restaurant bank credit was not established.

![Synthetic mobile customer preview](mobile-preview.png)

![Synthetic pending checkout recovery](pending-checkout-preview.png)

## CI

A PR run will verify the exact reviewed source, public smoke and isolated synthetic browser suite. Its run URL/head SHA/result will be recorded here after completion. Browser test evidence is uploaded as a GitHub Actions artifact. No CI result is assumed before the run finishes.
