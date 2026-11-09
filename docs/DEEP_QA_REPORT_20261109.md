# Bite deep QA — 9 November 2026

**Result: the complete product vision is not yet production-complete.** Core implemented workflows passed the checks below after defects were repaired. A passing database role simulation or public browser check does not certify an authenticated three-panel paid journey.

Requirements: `docs/PRODUCT_BLUEPRINT.md`, including the later twelve-section Owner scope. Source baseline: `067e1beef734f553427f617f6280a43add33058b`. This report accompanies the tested corrective patch.

## Repairs applied

| Defect reproduced | Correction and regression evidence |
| --- | --- |
| One Owner could be assigned to a second restaurant through the database. | The assignment trigger checks both directions and takes an Owner-specific transaction lock. Existing mappings were preserved. The previously failing assignment test passes. |
| A paused-delivery restaurant could still produce a live payment intent. | Server payment preparation blocks delivery pause. Pickup remains available when supported; both cases pass. |
| A temporarily closed restaurant could still produce a live payment intent. | Server preparation checks closure expiry and India operating hours. The storefront also respects normal/overnight hours and disables checkout while closed. |
| The verified payment finalizer ignored a restaurant's commission override. | Restaurant override takes precedence over the platform default. The failing 7.5% versus 10% case now passes. Paid activation remains service-only and idempotent. |
| Signed webhook verification accepted a missing/nonnumeric provider amount in isolated tests. | Both current and legacy callback paths require finite matching amounts. Invalid signatures, expired signatures, unpaid responses, wrong amounts and malformed amounts are denied. |
| A Customer could review or complain about a completed legacy order with no customer link, or request cancellation of an unlinked accepted order. | Three Customer RPCs now require null-safe exact ownership. All three invalid actions are denied; a legitimate linked review/complaint still works. |
| Five new payment/draft foreign keys lacked covering indexes. | Five indexes were added; the follow-up advisor reports no unindexed foreign keys. |

Database migrations: `20261109152400_bite_deep_qa_owner_checkout_guards` and `20261109164846_bite_customer_order_null_ownership_guard`. `cashfree-webhook` is deployed as version 7 with its existing signature-based authentication. JWT-protected customer endpoints retain their existing authentication. No gateway configuration flag, customer payment, refund, payout or existing Owner mapping was changed.

## Executed checks

| Layer | Result | What it establishes |
| --- | --- | --- |
| Frontend and Owner structure checks | Passed | Script syntax, independent pages, unique IDs and critical route/payment guards. |
| Node behavior cases | 33 passed | Owner/Admin route separation; reports and exports; discovery/menu; India/overnight operating hours; checkout readiness/retry/sandbox separation; callback signature, amount and idempotency cases. Provider/network operations in these cases are mocked. |
| Owner database groups | 10 passed | Tenant/view isolation, Menu CRUD, Tables, Expenses/Cashbook, Khata, manual accounts, suppliers/purchase/stock, negative stock, HR attendance/leave approval/salary, Settings/commission denial and closing reconciliation. |
| Delivery database groups | 3 passed | Accept → prepare → ready → handoff; pickup completion; bearer token, five-attempt lock, token rotation, customer-only OTP and successful consumption. |
| Admin/Customer database groups | 15 passed | Private profile/address/history isolation; cancellations; reviews/replies/moderation; support; approval/audit; Admin operational boundaries; metadata spoofing; publication/suspension/reactivation; payout-detail approval; complaints; anonymous denial. |
| Checkout/security database groups | 11 passed | Ownership denials; one restaurant per Owner; server pricing and area fee; pause/closure/hours; pickup; unpaid activation denial; quantity validation; restaurant commission and callback idempotency. |
| Legacy null-customer ownership groups | 4 passed | Completed-order review/complaint and accepted-order cancellation request denied without ownership; legitimate linked actions remain valid. |
| Actual XLSX bytes | Passed | Reopened with openpyxl: Hindi text, numeric amounts and formula-like text retained as a literal string. |
| Public browser smoke | See the matching successful Bite QA workflow for this patch | Live public discovery/menu/cart, login/reset input validation, account fields and desktop/390px/340px layout. This suite does not log in as Owner/Admin or charge a customer. |

The **43 database groups** ran against live PostgreSQL with temporary role claims and isolated fixtures. Every test fixture/business write was rolled back. Read-back counts of existing orders, checkout intents, addresses and support tickets were unchanged; no temporary QA identities from these runs remained. Sensitive customer details, credentials, OTPs and business totals are omitted from the public evidence.

An additional Owner/HR repeat variant was not completed because its native database confirmation expired. It is excluded from the pass count. The successfully executed Owner baseline is retained. Advance/bonus and leave-rejection authenticated UI actions are not certified by the salary/leave-approval group above.

## Original-plan coverage

`DB pass` means the implemented backend flow was exercised with rollback fixtures. `Partial` and `Unverified` are deliberate limits, not passes.

| Panel | Planned area | Current assessment |
| --- | --- | --- |
| Customer | Public restaurant/menu browse, search, categories, delivery/pickup filters, menu veg filter | Implemented; public browser and behavior coverage. |
| Customer | Selected-address/PIN-based restaurant listing | Partial. Current nearby discovery provides proximity/service selection; a complete saved-address/PIN-driven discovery filter is absent. Checkout's server PIN restriction is separately tested. |
| Customer | Rating/low-price/low-delivery-fee/Open Now dedicated filters, featured/popular curation | Partial; the full planned filter/curation set is absent. |
| Customer | Profile and saved-address isolation/CRUD | DB pass; mobile Account fields covered by browser smoke. |
| Customer | Fresh signup, email delivery, full recovery-link/password reset, session expiry | Unverified in a new real account during this run. Current Customer form is email based; the originally planned mobile-password entry is not certified. |
| Customer | Cart quantity, one restaurant and persistence | Implemented; public cart and isolated behavior checks. |
| Customer | Normal online checkout and server-confirmed order activation | Model/DB checks pass; no new authenticated paid transaction was performed. Existing verified-payment records are evidence of prior use, not a new E2E pass. |
| Customer | PIN restriction, delivery fee, pickup, closed/paused restaurant checks | DB pass; unavailable restaurants cannot prepare a new payment intent through the tested RPC. |
| Customer | Cancellation, requests, reviews and complaints | DB pass with ownership/status checks. Cancellation is not a provider refund. |
| Customer | Support ticket and Admin reply tracking | DB pass. |
| Customer | Favourites, reorder, downloadable Customer PDF invoice | No complete Customer UI/backend flow found. Owner printable bills are a separate implemented feature. |
| Customer/Owner/Admin | Coupons, offer calculation and management | No complete schema/UI flow found. |
| Owner | Overview and twelve retained pages | Existing route/structure/behavior checks pass. A new authenticated button-by-button browser walkthrough was not performed. |
| Owner | Accept/reject, prepare/ready and delivery/pickup lifecycle | DB role simulation pass. Real order alert sound/notification delivery was not exercised. |
| Owner | Secure delivery link, rotation, OTP and completion | DB pass. No WhatsApp message was sent. Actual location/phone interactions were not performed. |
| Owner | Menu/categories/prices/availability | DB pass. Image URLs/static assets work in the implementation; secure photo uploads are incomplete. |
| Owner | Expenses, Khata, Cashbook/closing, Purchases, stock, Tables | DB pass for the documented operations. |
| Owner | Staff/attendance/manual salary and leave approval | DB pass for the documented operations; payroll automation is excluded. |
| Owner | Hours, pause, PIN zones, fee/minimum and protected identity changes | DB pass; direct identity/commission bypass denied. |
| Owner | Reports and printable bills | Behavior/format checks pass; a new authenticated print/download walkthrough was not performed. Cash movement is not certified net profit. |
| Admin | Restaurant approval, publication, suspension/reactivation | DB pass; an Owner cannot self-publish/approve. |
| Admin | Restaurant identity and payout-detail approval, review moderation, support/audit | DB pass. Payout-detail approval does not transfer money. |
| Admin | Commission default and restaurant override | Guard/override checks pass after the fix. |
| Admin | Customer list, suspension/reactivation and complete website/category/featured management | Incomplete relative to the full plan. |
| Finance | Signed provider callback and trusted verification | Isolated callback tests and database activation checks pass. No newly paid, refunded or settled transaction was executed. |
| Finance | Marketplace KYC/split settlement, actual provider refunds/payouts and reconciliation | Not certified/complete; current financial/settlement drafts are not bank execution. |
| Operations | Five-minute unanswered-order cancellation and automatic provider refund | No complete scheduled implementation found; the database has no configured cron schema. |
| Notifications | Foreground order/history realtime and sound | Code and realtime publication foundations exist. Background browser push, email/SMS delivery and receipt verification are incomplete/unverified. |
| Storage | Secure document/menu/bill-photo uploads | No configured storage buckets were found. |
| Security | Public tables and reporting views | All 47 public tables have RLS; all 5 reporting views use caller permissions. Selected role boundaries passed the live tests. |
| UI | Customer desktop/mobile layouts | Public automated coverage; physical Android, broad device coverage and freshly authenticated Owner/Admin mobile flows remain unverified. |
| UI | Hindi/English language switch | Mixed Hindi/English labels are present; a complete language-switch workflow was not found. |

The accepted scope excludes active POS creation/refunds, KOT/KDS, platform delivery-driver accounts, aggregator integrations, multiple branches and automated payroll. These are not counted as missing launch features.

## Remaining security/verification limits

- Password leak protection remains disabled in Auth settings: [Supabase remediation](https://supabase.com/docs/guides/database/database-linter?lint=auth_leaked_password_protection).
- Advisor notices remain for 4 anonymous and 34 authenticated SECURITY DEFINER functions. Callable privileged functions require individual purpose/guard review; the notice count alone does not prove an exploit. This run exercised selected critical endpoints and did not certify all 87 database functions: [function review guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- The delivery-handoff table intentionally uses RLS without direct table policies; access is through the token/OTP RPCs. Fourteen multiple-permissive-policy notices remain. New unused-index notices are informational; required FK indexes were retained.
- No new real Owner/Admin/Customer password login, delivered reset email, paid checkout, actual refund/payout, external notification, browser push, sustained concurrency/load, backup restoration or physical-device certification was performed.

## Repeatability

1. Run the existing frontend/Owner checks and `node --test scripts/owner_behavior.test.cjs scripts/redesign.test.cjs scripts/checkout_behavior.test.cjs scripts/webhook_behavior.test.cjs`.
2. `python scripts/prepare_deep_qa.py` generates ephemeral rollback-only Owner and Delivery SQL in ignored `dist/deep-qa`.
3. Use the authorized Supabase SQL workflow to run those two generated files and `scripts/deep_admin_customer_regression.sql` / `scripts/deep_security_payment_regression.sql` and `scripts/deep_null_ownership_regression.sql` (the latter uses the existing unpublished QA restaurant); inspect returned assertions and confirm rollback. Honor any native confirmation. These are database-role tests, not Auth logins.
4. Review the matching GitHub Bite QA deployment checks and the sanitized evidence JSON beside this report.

**Release assessment:** the repaired implemented core has substantive test evidence. The full envisioned product still requires the incomplete features and authenticated/provider acceptance flows above before an unrestricted production-complete claim.
