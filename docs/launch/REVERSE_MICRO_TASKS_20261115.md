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
- [ ] 6.11b Verify actual image HTTP loading, dish relevance, Pure Veg representation and public-facing credits in an isolated browser; link existence is not image success.
- [ ] 6.12 Confirm minimum-order and delivery-fee commercial values with restaurant owner (currently ₹1 / ₹0).
- [ ] 6.13 Check serving PINs, delivery range, pickup details and opening/closing times against real operations.
- [ ] 6.14 Verify a dedicated, non-conflicted Owner account can control this restaurant from the Partner APK.
- [ ] 6.15 Run an isolated no-money Customer → Owner → Delivery OTP rehearsal with role-scoped test data.
- [ ] 6.16 Record named duty operator, support procedure, restaurant consent and verified operating window.
- [ ] 6.17 Verify legal/customer-facing disclosures, refunds, FSSAI/tax applicability with qualified parties.
- [ ] 6.18 Obtain separate GO decisions for code publication, paid checkout and public marketing.
- [ ] 6.19 Run a **small controlled paid pilot only after Phase 1 payment/security gates pass**.
- [ ] 6.20 Reconcile pilot charge, fee, refund (if any), restaurant payout, support outcome and order completion.

## Phase 5 — Admin, security and delivery
- [ ] 5.01 Inventory all Admin/Super Admin roles and routes; keep Owner features separate.
- [ ] 5.02 Audit conflicting restaurant membership mappings; preserve existing data.
- [ ] 5.03 Verify Hotel Maharani Palace has precisely the intended authorized Owner.
- [ ] 5.04 Verify restaurant approval/suspension cannot be changed by Owner.
- [ ] 5.05 Confirm customer data and another restaurant's orders cannot be read by Owner.
- [ ] 5.06 Test Admin owner reset and role-change authorization negative cases.
- [ ] 5.07 Review privileged SECURITY DEFINER functions and explicit grants.
- [ ] 5.08 Review password protection, login recovery and rate limits.
- [ ] 5.09 Verify delivery link expiry, customer data visibility and OTP attempt limits.
- [ ] 5.10 Complete physical delivery OTP success and invalid/expired-link tests.
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
**6.11b**: isolated browser image-load and attribution verification for the 91 external Commons links. Keep 6.08b (physical Android), 6.09b (verified commercial menu), and 6.10b (kitchen availability intent) open until confirmed. No production menu writes without verified approval.
