# Bite — Reverse Micro-Execution Tracker
Last inspected: 15 Nov 2026 (Asia/Kolkata)
Project: gauravjoshi2999/restaurant-os; Supabase: wedbgpybbgsszcmffoha

## Operating rules
- Execute phases in reverse order: **6 → 5 → 4 → 3 → 2 → 1**, one independently verifiable micro-task at a time.
- A checked code task means that specific code/static check passed; it does **not** certify a physical phone test, real bank credit, provider split, or commercial launch.
- Do not turn on unrestricted paid ordering, refund execution, public marketing, or restaurant payout until all corresponding provider/compliance/security gates pass.
- Read-only inspections, draft preparation, and non-financial UI fixes are safe to advance while final provider approval is pending. Avoid editing real prices, menus, ownership, commission, or bank details without verified inputs.
- Every completed item requires code/DB evidence, a test, or a known external approval. Note any gaps precisely.

## Read-only production findings — 15 Nov 2026
- Restaurant ID: `262aaba7-f48b-4fa5-9ff6-b334ededca84`; Hotel Maharani Palace, Rajsamand.
- Database currently shows Active, onboarding approved, published, not temporarily closed, delivery not paused; delivery + pickup enabled. These flags alone are **not** a commercial launch authorization.
- Menu: **92** rows, **67** available, **91** with nonblank image URL, **0** items marked non-vegetarian. Requested target from owner: **112** dishes. Missing 20 items cannot be fabricated from a count alone.
- Restaurant minimum order configured as **₹1.00** and default delivery fee as **₹0.00**. These are database values, **not** confirmed desired commercial rules. Do not guess replacements.
- Owner feedback: `owner-feedback.html` with ACTIVE `bite-owner-feedback` Edge Function; response table exists; **0** rows at inspection. Table RLS enabled; `anon` and `authenticated` lack direct SELECT; `anon` lacks direct INSERT.
- Survey code: four-step progress display corrected, Back/Next scroll only after interaction, success requires backend `ok:true`. Commits `7be8490`, `08ad6ca`. Regression tests added at `scripts/owner_feedback_regression.test.cjs`, commit `d663b49`.
- Static invariant checks run for 4-step count, navigation, server acknowledgement, endpoint, and test file, all true. **No live form submission**, physical-browser acceptance, or fresh full CI pass claimed.

## Phase 6 — Restaurant pilot / launch preparation (execute first)
- [x] 6.01 Verify feedback form exists and its Edge Function is ACTIVE.
- [x] 6.02 Verify feedback table access is private to public roles.
- [x] 6.03 Fix incorrect survey step count and false-positive confirmation.
- [x] 6.04 Fix survey step-navigation scrolling without initial auto-scroll.
- [x] 6.05 Add narrow automated regression assertions and inspect source invariants.
- [x] 6.06 Read current Hotel Maharani Palace publish/onboarding/Menu snapshot.
- [x] 6.07 Execute the **deployed Edge handler logic** with isolated POST + mocked readback; verified 201/ok, 400/403/503 rejection, non-consented phone redaction and **0 live survey rows**. This is **not** a live-network Endpoint test. Evidence: `docs/launch/OWNER_FEEDBACK_ISOLATED_EVIDENCE_20261115.md`.
- [x] 6.08a Run actual repository form in Chromium **mobile emulation** (320/390/430px), all 4 steps, validation, retry and fake-ack protection: **GitHub Bite QA #935 PASS**, no real API requests. Evidence: `docs/launch/OWNER_FEEDBACK_MOBILE_QA_GATE_20261116.md`.
- [ ] 6.08b Verify **physical Android** behavior and real server delivery/readback in an approved test environment (no fake live-research submissions).
- [x] 6.09a Name-level historical reconciliation: 91 old rows + 1 newly created Choklet; 21 old photo-credit labels no longer match, consistent with 112 earlier names. Read-only log timeline includes many DELETE requests on 15 Nov. See `docs/launch/MAHARANI_MENU_RECONCILIATION_20261116.md`.
- [ ] 6.09b Approve exact 21 restored/deleted decisions and verified prices/categories/availability against authoritative menu; do not invent values or perform speculative data writes.
- [x] 6.10a Read-only evidence: 25 rows currently unavailable and updated in the Nov 15 cluster; 13 categories, Kofta empty. No changes made.
- [ ] 6.10b Confirm whether 25 disabled items reflect genuine kitchen availability before re-enabling any.
- [x] 6.11a Read-only media inventory: 91 externally hosted Wikimedia Commons URLs, 1 blank Choklet image, photo licensing documented in 9 repo credit files. See `docs/launch/MAHARANI_MEDIA_SOURCE_AUDIT_20261116.md`.
- [x] 6.11b Run real Chromium network tests of all 91 URLs: 33/91 bulk-load, 58 transient-looking errors; separate clean-runner serial retest loaded 7/7. See `docs/launch/MAHARANI_IMAGE_LOAD_DIAGNOSTIC_20261116.md`.
- [x] 6.11c Create and merge customer-facing photo-source page for 91 current images, scoped to Maharani, with source links and mobile search; PR #129 Bite QA passed. **Actual GitHub Pages deploy not yet separately confirmed**.
- [ ] 6.11d Certify every photo's exact license, attribution completeness, matching Pure Veg dish and device/browser loading; 7/7 clean-runner check is not 91/91.
- [x] 6.12a Read-only verification: restaurant and Rajsamand delivery zone both specify minimum order ₹1 and delivery fee ₹0; no production changes.
- [ ] 6.12b Get confirmed commercial order minimum and fee rules from restaurant operator; do not guess replacements.
- [x] 6.13a Read-only verification: 1 active Rajsamand delivery zone, PIN 313324, pickup/delivery enabled, 10:00–23:00 hours and 30-minute prep; **restaurant address and map coordinates NULL**.
- [ ] 6.13b Confirm actual pickup address, map coordinates, business hours and geography; do not fabricate geolocation.
- [x] 6.14a Check membership mapping: one Maharani Owner membership, zero cross-restaurant linked users and zero multi-owner restaurants at inspection.
- [ ] 6.14b Authenticate dedicated Owner on real Partner APK, verify menu actions/session and lockscreen alerts.
- [x] 6.15a Isolated PostgreSQL integration: synthetic Owner, Customer, delivery token and OTP complete exactly once, no money/production writes (PR #136).
- [ ] 6.15b Exercise full Customer → Owner → WhatsApp delivery handoff on real apps with a test order; distinguish this from isolated RPC simulation.
- [ ] 6.16 Record named duty operator, support procedure, restaurant consent and verified operating window.
- [ ] 6.17 Verify legal/customer-facing disclosures, refunds, FSSAI/tax applicability with qualified parties.
- [ ] 6.18 Obtain separate GO decisions for code publication, paid checkout and public marketing.
- [ ] 6.19 Run a **small controlled paid pilot only after Phase 1 payment/security gates pass**.
- [ ] 6.20 Reconcile pilot charge, fee, refund (if any), restaurant payout, support outcome and order completion.

## Phase 5 — Admin, security and delivery
- [x] 5.01a Verify static route matrices: Owner has 13 permitted pages, Super Admin has 10, enforced by applyRoleUI/showPage and app-scope guards; added regression in PR #132, Bite QA passed. See `docs/launch/ROLE_ROUTE_AND_RLS_REVIEW_20261116.md`.
- [ ] 5.01b Verify signed-in APK role isolation and navigation against authenticated test identities.
- [x] 5.02 Audit production mappings read-only: 5 memberships, 5 distinct users, 5 restaurants; no multi-restaurant or multiple-owner conflicts; no Admin/Owner membership overlap on inspected rows.
- [x] 5.03a Verify Maharani has exactly 1 owner membership in database.
- [ ] 5.03b Verify intended person's identity/actual Partner login using authorized sign-in; do not infer identity from count.
- [x] 5.04a Inspect approval, publication and commission triggers: non-admin field updates raise exceptions; RLS enabled.
- [ ] 5.04b Execute authenticated Owner vs Admin negative E2E with isolated test account, no live approval mutation.
- [x] 5.05a Execute transaction-scoped live **read-only** Owner RLS smoke over five existing memberships, asserting no cross-restaurant private restaurant row, membership, unrelated-customer orders, cashbook or inventory balance access. ROLLBACK, no business-data writes. Evidence: `docs/sql/owner_tenant_rls_readonly_20261116.sql`.
- [ ] 5.05b Verify Owner A vs Owner B under actual independent authenticated browser/Partner app sessions and direct HTTP API (not just simulated JWT claims).
- [ ] 5.06 Test Admin owner reset and role-change authorization negative cases.
- [x] 5.07a Inventory 79 SECURITY DEFINER functions, five anonymous-callable and 52 authenticated-callable, all with explicit search_path; read the five anonymous function purposes and eight high-impact Admin/finance guards. Evidence: `docs/launch/DELIVERY_AND_RLS_ACCEPTANCE_20261116.md`.
- [ ] 5.07b Review every remaining privileged callable function for authorization, input restrictions, grants, return fields and data access with negative test coverage.
- [ ] 5.08 Review password protection, login recovery and rate limits.
- [x] 5.09a Read-only server RPC/permissions audit: token SHA-256 hashed; default 24h expiry; five wrong OTP attempts; owner-only link creation; no direct handoff table grants; bearer link exposes customer address until expiry. See `docs/launch/DELIVERY_HANDOFF_SECURITY_REVIEW_20261116.md`.
- [x] 5.09b Run actual deployed delivery RPC definitions in isolated PostgreSQL 17 with synthetic Owner/Customer/anon roles: wrong OTP five tries, sixth blocked, Owner B denial, bearer/token rotation, expired/consumed links, customer-only OTP, exactly-one status event; PR #136, Bite QA passed.
- [ ] 5.09c Test simultaneous deliveries/OTP submissions and lock races, invalid token exposure, physical-device network delays; not covered by sequential isolated SQL.
- [x] 5.10a Improve real delivery page OTP-first mobile UX and add in-page handover status refresh; remove broken demo link. Mock RPC Chromium 390px test passed, PR #137 merged.
- [ ] 5.10b Complete physical Android Owner → WhatsApp delivery link → 4-digit OTP and invalid/expired link tests without changing any real-money order.
- [ ] 5.11 Review refund/commission/settlement audit logs with evidence.
- [ ] 5.12 Backup and isolated restore rehearsal; record recovery owner.

## Phase 4 — Customer experience
- [ ] 4.01 Verify first-login location consent screen.
- [ ] 4.02 Verify GPS/reverse-geocoder PIN mismatch does not overwrite the chosen serviceable PIN.
- [ ] 4.03 Verify restaurant discovery by valid/invalid delivery PIN.
- [ ] 4.04 Verify food search, veg filters, images and menu anchors.
- [ ] 4.05 Verify guest cart persists after Google/email login.
- [ ] 4.06 Verify minimum-order quick add without leaving checkout.
- [ ] 4.07 Verify item quantity/remove/clear, restaurant switching and checkout back.
- [ ] 4.08 Verify coupon/fees/total before checkout.
- [ ] 4.09 Verify safe checkout retry and no duplicate payment attempt.
- [ ] 4.10 Verify My Orders loads promptly and detail opens without replacing the list.
- [ ] 4.11 Verify unpaid cancellation never displays 'refund initiated'.
- [ ] 4.12 Verify paid cancellation shows only provider-confirmed refund status and reference.
- [ ] 4.13 Verify missing-email/autofill problems in customer search and login.
- [ ] 4.14 Verify Android responsive design and accessibility at small widths.

## Phase 3 — Owner OS
- [ ] 3.01 Audit actual current Owner navigation; remove duplicate actions.
- [ ] 3.02 Verify Owner Overview counts paid live data, not demo/unpaid money.
- [ ] 3.03 Verify Orders list, search, history and status transitions.
- [ ] 3.04 Verify menu add/edit/image/availability from Owner account.
- [ ] 3.05 Verify POS item search, plus/minus quantity and billing where explicitly in current scope.
- [ ] 3.06 Verify printed/WhatsApp bill accuracy and consented marketing text.
- [ ] 3.07 Verify expenses, cashbook and day-wise accounting calculations.
- [ ] 3.08 Verify inventory and purchases without unsupported automatic stock claims.
- [ ] 3.09 Verify staff attendance, salaries and advance manual entries.
- [ ] 3.10 Verify tenant-scoped reports, Excel/PDF and privacy.
- [ ] 3.11 Verify Settings persistence (fees, hours, area, pickup/delivery).
- [ ] 3.12 Verify Owner APK session persistence and foreground/background behavior.

## Phase 2 — Multiple orders and notifications
- [ ] 2.01 Test two simultaneous real-looking orders in isolated staging.
- [ ] 2.02 Test five simultaneous orders; show distinct cards and IDs.
- [ ] 2.03 Test twenty rapid events without duplicates or lost status changes.
- [ ] 2.04 Verify independent Accept/Reject actions and reasons.
- [ ] 2.05 Verify 5-minute expiry behavior in trusted backend and refund-eligibility gate.
- [ ] 2.06 Verify owner foreground sound + visible in-dashboard alarm.
- [ ] 2.07 Verify Android locked-screen notification delivery.
- [ ] 2.08 Verify notification action permissions and idempotent Accept/Reject.
- [ ] 2.09 Verify cancellation-request notification separate from new-order notification.
- [ ] 2.10 Verify dropped realtime events are recovered by scoped polling.
- [ ] 2.11 Confirm no cross-restaurant event leakage.

## Phase 1 — Payments and refunds (last in requested reverse work order; still a launch prerequisite)
- [ ] 1.01 Confirm Cashfree merchant status and approved marketplace Easy Split model.
- [ ] 1.02 Confirm restaurant vendor onboarding/KYC and bank verification in provider portal.
- [ ] 1.03 Confirm contract, commission, gateway fee, payout and tax treatment.
- [ ] 1.04 Verify live/sandbox credentials are isolated and server-only.
- [ ] 1.05 Verify server creates one idempotent order session with authoritative total.
- [ ] 1.06 Verify signed/validated payment webhook and provider GET fallback.
- [ ] 1.07 Verify browser cannot fake PAID or start duplicate charges.
- [ ] 1.08 Verify cancellation eligibility and refund-job creation rules.
- [ ] 1.09 Verify refund API success, unknown timeout reconciliation and no double refund.
- [ ] 1.10 Verify payment amount, refund status, gateway fee, commission and payout ledger remain separate.
- [ ] 1.11 Obtain provider evidence for real restaurant split and actual payout reference.
- [ ] 1.12 Execute documented sandbox then strictly approved low-value real-money acceptance with secure bank reconciliation.

## Next smallest task
**5.04b, 5.05b, 5.07b and 5.09c**: targeted authenticated authorization negative tests and concurrent OTP race checks. Isolated PG delivery RPC suite and production read-only Owner RLS smoke have passed; still need true APK/HTTP acceptance and provider finance gates. See `docs/launch/DELIVERY_AND_RLS_ACCEPTANCE_20261116.md`.
