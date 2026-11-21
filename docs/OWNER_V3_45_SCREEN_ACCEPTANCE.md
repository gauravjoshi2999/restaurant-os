# Owner V3 — 45-screen acceptance checklist

Reference: user-approved `Bite Owner — Complete Editable Dashboard & Workflows.pdf` (45 pages, H01–H15, R01–R15, A01–A15). This is an evidence register, not a claim of complete functionality. Updated 2026-11-20.

## Status rules
- **Complete & Verified (V):** current approved UI, every required interaction, backend/role and money integrity, error/retry, applicable 320/360/390/430px + tablet/desktop tests, and current production release acceptance documented with exact commit/run evidence.
- **Partially Complete (P):** existing implementation/test/PR evidence to investigate; full screen acceptance has not been recorded. Candidate test file names are not proof that every acceptance behavior passed.
- **Pending (N):** full current-screen audit not done and supporting evidence insufficient to classify the implementation; this does not mean no code exists.
- **Blocked (B):** remaining acceptance cannot proceed without a documented dependency/permission/device. Record the exact blocker. Do not mark the whole screen blocked if independent work remains.

**Baseline:** V 0 / P 43 / N 2 / B 0 = 45 screens. Strict verified-screen percentage = 0/45 = 0%; this measures documented full acceptance, not code completion. The previous approximate 70% development estimate was not an audited metric. No replacement estimate is invented. Do not count QA jobs as screens.

## Current release checkpoint
- H12 [PR #239](https://github.com/gauravjoshi2999/restaurant-os/pull/239), merged; included in verified H13 release below.
- H13 [PR #241](https://github.com/gauravjoshi2999/restaurant-os/pull/241), branch QA and main QA passed; [Pages 44599342870](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44599342870), deployed SHA `4c39020048ebbba9d59e92fdd6ee5bb563ec8dff`.
- H14 [PR #243](https://github.com/gauravjoshi2999/restaurant-os/pull/243), [10-job QA 44598533464](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44598533464) passed at `6148c04e99ce32ae66be7eb0f51b32533483fc81`; merged `2d7099a45ca18bd87108612d34d79e4188a50d70`. [Main QA 44695605620](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44695605620) and exact-SHA Pages confirmation pending as of baseline snapshot. Verify again before next claim.
- H15/R08 historical register stale-response/truncation guard developed on `fix/owner-v3-h15-r08-history-list-integrity-20261120`; initial regression and release gates pending.
- Supabase project active; read-only column check confirmed historical entry amounts and dates are non-null. Security advisor warnings (SECURITY DEFINER executable grants and leaked-password protection) require targeted review, not blanket revoke. No production mutation performed for this checkpoint.
- Authenticated Owner manual acceptance, physical Android notifications, real printer/WhatsApp file sharing remain unverified; no production financial transaction authorized for tests.

### Release evidence update — 2026-11-20
- R07 [#245](https://github.com/gauravjoshi2999/restaurant-os/pull/245): branch QA 44756035554 successful at `f0d8a946344e5863ba0582047afd078e53cc0f83`; merged SHA `c729d901dbd29b71b82be098b849037cb0c6713b`, main QA 44757859387 and Pages 44760200108 successful, including public guest-browser smoke. Authenticated Owner acceptance remains outstanding.
- A03/A12 [#246](https://github.com/gauravjoshi2999/restaurant-os/pull/246): branch QA 44759200520 successful at `21bc183ddb02a731b5730159f67fc16de3471366`; merged SHA `b26cb365cb22ae593a71544d39d4b61cf59e40d1`, main QA 44761696686 and Pages 44763022435 successful. Real Owner reconciliation acceptance remains outstanding.
- A03 [#249](https://github.com/gauravjoshi2999/restaurant-os/pull/249): branch QA 44761826005 successful at `875e655b58941430b6ee139ac053d7db603e813f`; merged SHA `74cb3d5113013dd2de2e056e90a4fb99507bd8a0`. Main QA 44764298823 pending at snapshot; Pages not yet verified.
- H15/R08 [#250](https://github.com/gauravjoshi2999/restaurant-os/pull/250): previous head `e8bcd228c56a6551fb2ec64c8f33b5a6f21ac40e` QA 44762107791 passed after syntax/DOM-fixture fixes. Refreshed head `7ea3031e4a10af91829abe8187fc851ec9427975` QA 44764381258 pending; guard clears visible history when loader is called without owner/scope. Actual session-switch behavior still requires acceptance.
- H02 [#251](https://github.com/gauravjoshi2999/restaurant-os/pull/251): previous head `10337946b0da7b93a56e0a7f38ea72a078406de8` QA 44762580946 passed. Refreshed against #249 with updated cache version; latest QA and release pending.
- Next: verify #249 main QA and Pages, then refresh/review/merge #250 and #251 sequentially with exact-head QA and separate deployment checks. No change to verified-screen count; synthetic QA and public guest smoke do not establish full authenticated acceptance. No production financial mutation.

### Release evidence update — 2026-11-21
- #253 H09: merged `1e8b6d4702a56b6aee25ddd6083b5150af51cc1e`; main QA 44791841800 and Pages 44793101400 passed.
- #254 H06: merged `7ba625b643b8e5d9788a2562e21c34109128b703`; main QA 44794050853 and Pages 44795313362 passed.
- #255 H08: merged `e801671d5cf42462e1de4ed575b2d77dc145d805`; main QA 44804478853 and Pages 44805707016 passed.
- Next gate: #256 H10 exact-head QA, main QA and Pages before #257 H13 and #258 H14. Preserve both accounting patches.
- H01–H15 remain P: authenticated Owner session and applicable device/printer/share acceptance unavailable in this execution; individual remaining checks listed below. No verified-screen count change.

## Screen register

| ID | Approved screen | Status | Existing code/test/PR evidence locator | Remaining acceptance |
|---|---|---|---|---|
| H01 | Owner workspace | P | scripts/owner_v3_pdf_h01_more.test.cjs | Role-specific navigation and back routes on all widths |
| H02 | Home mobile | P | scripts/owner_v3_pdf_h02_finance.test.cjs | Signed-in selected date metrics, live alert and room links |
| H03 | Home desktop | P | scripts/universal_owner_browser.py | Desktop parity at 1440px with current production scope |
| H04 | Hotel rooms | P | scripts/owner_v3_h04_h05_room_details.test.cjs; PR #229 | Availability and floor/type filter with real authorized data |
| H05 | Room detail | P | scripts/owner_v3_h04_h05_room_details_browser.py; PR #224 | Move/extend/extras/food links and concurrency |
| H06 | Hotel register | P | docs/qa/guest-register-history.md; PR #228 | Historical day/month/range, export and protected ID view |
| H07 | Guest check-in | P | docs/qa/checkin-25-scenarios.md; PR #230 | Repeat guest/draft recovery and owner-access acceptance |
| H08 | Check-in multiple rooms | P | scripts/family_booking.test.cjs; PR #233 | Capacity/date conflict and family allocation |
| H09 | Guest ID photos | P | docs/qa/checkin-id-photo-review.md | Front/back retake, remove, authorization and physical device |
| H10 | Payment and review | P | scripts/owner_guest_controls_pg_test.sql | Advance/security separation, retry and verified online receipt |
| H11 | Reservations | P | scripts/owner_v3_h11_reservation_views.test.cjs; PR #236 | Modify/cancel/no-show/refund status and actual availability |
| H12 | Guest bill — room + food | P | scripts/owner_v3_h12_linked_balance.test.cjs; PR #239 | Source POS link, adjustments and owner acceptance |
| H13 | Family checkout | P | PR #267; exact main QA 44910541726; Pages 44911167987; Supabase migration 20261121134610 | Code deployed: selected rooms, split tender, individual credit checkout, Guest Khata recovery. Authenticated owner/device acceptance remains. |
| H14 | Invoice / print / WhatsApp | P | scripts/hotel_accounts.test.cjs; PR #243 | Current main rollout, final PDF/WhatsApp file and consented share |
| H15 | Historical stay / cleaning | P | assets/owner-historical-entries.js; scripts/owner_housekeeping_display.test.cjs | Historical period completeness, request race, housekeeping off/on |
| R01 | POS overview | P | scripts/pos_calendar_reports_step3.test.cjs | Bill history, covers and totals by period on device |
| R02 | POS items | P | scripts/pos_v2_mobile_step1.test.cjs; scripts/owner_pos_menu_workspace.test.cjs | Search, quantity, cart and keyboard accessibility |
| R03 | POS bill review | P | scripts/pos_payment_safety.test.cjs | Pay now / due / room and draft review |
| R04 | POS payment | P | scripts/pos_payment_browser_smoke.py | Actual receipt date, split, verified UPI, idempotency |
| R05 | Charge to room | P | scripts/family_booking_pg_test.sql; docs/universal-owner/RELEASE.md | Correct stay/folio source, reversals and no duplicate revenue |
| R06 | Saved bill | P | scripts/owner_v3_pos_daily_book_receipts.test.cjs | Bill to original receipt and Daily Book navigation |
| R07 | POS day/month | P | scripts/pos_historical_calendar.test.cjs | Shared picker, calendar and verified period totals |
| R08 | POS drafts and old entries | P | scripts/pos_draft_lifecycle.test.cjs; scripts/owner_v3_historical_pos_reconciliation.test.cjs | Old records/draft isolation, completeness and stale response test |
| R09 | Orders live queue | P | scripts/owner_orders_workspace.test.cjs; scripts/owner_order_burst.test.cjs | Concurrent paid order handling and live reconnect |
| R10 | Accept/reject | P | scripts/owner_multi_order_actions.test.cjs | Real status transition, permissions and paid checks |
| R11 | Ready and handover | P | scripts/owner_delivery_regression.sql | Delivery OTP and recovery without duplicate state changes |
| R12 | Cancellation/refund | P | scripts/owner_cancellation_fcm.test.cjs | Provider-confirmed refund outcome; no actual transaction for QA |
| R13 | History and notifications | P | scripts/owner_order_calendar_workflow.test.cjs; scripts/owner_notification_settings_v17.test.cjs | Native notification/sound and date history on device |
| R14 | Menu catalog | P | scripts/owner_menu_delete_safety.test.cjs; scripts/owner_menu_options.test.cjs | Live item CRUD, availability and photo/price parity |
| R15 | QR menu/tables | P | scripts/menu_qr_view_only.test.cjs; scripts/menu_qr_browser_smoke.py | Printed scan and live menu update; no guest ordering |
| A01 | More | P | scripts/owner_v3_pdf_h01_more.test.cjs; scripts/owner_more_mobile.test.cjs | Single navigation and back behavior by capability |
| A02 | One date picker | P | scripts/owner_v3_pdf_a02_period.test.cjs | All relevant screens share and reset correct period |
| A03 | Daily Book / collections | P | scripts/owner_v3_pdf_a03_collections.test.cjs; scripts/owner_v3_pos_daily_book_receipts.test.cjs | Receipt source-once and original received date |
| A04 | Expenses / supplier dues | P | scripts/owner_v3_pdf_a04_expenses.test.cjs; scripts/owner_v3_a04_supplier_payments.test.cjs | Paid now/pay later, partial supplier payment, no duplicates |
| A05 | Customer khata | P | scripts/owner_v3_pdf_a05_khata.test.cjs | Opening balance, source links and due collection |
| A06 | Settlements/refunds | P | scripts/owner_v3_pdf_a06_settlements.test.cjs | Provider reconciliation and stale/error states |
| A07 | Inventory/purchases | P | scripts/owner_v3_a07_inventory.test.cjs | Unit-safe stock and supplier source links |
| A08 | Staff/attendance | P | scripts/owner_v3_a08_attendance.test.cjs; scripts/owner_a08_staff_record_safety.test.cjs | Attendance, leave, employee access and recovery |
| A09 | Salary/advances | P | scripts/owner_v3_a09_staff_payments.test.cjs; scripts/owner_v3_a12_salary_payment_safety.test.cjs | Salary cost vs payment, advance, duplicate prevention |
| A10 | Reports | P | scripts/hotel_accounts.test.cjs; docs/universal-owner/RELEASE.md | Current report and export parity across dates and tenants |
| A11 | Cash reconciliation | P | scripts/owner_cash_closing.test.cjs; scripts/cashbook_closing_db_test.sql | Actual drawer variance, locking, late entries |
| A12 | Linked accounting examples | P | scripts/owner_v3_historical_pos_reconciliation.test.cjs; docs/universal-owner/RELEASE.md | Cross-module source-once acceptance on current build |
| A13 | Reviews/help | N | Existing review handler in index.html; not yet screen-audited | Dedicated current owner reviews/help UI and backend audit |
| A14 | Settings/modules/access | P | scripts/owner_guest_controls.test.cjs; scripts/universal_owner.test.cjs | Capability dependencies, roles and optional modules |
| A15 | Changes/recovery/handoff | N | Older docs/universal-owner/RELEASE.md; not a V3 acceptance audit | V3 recovery, operational handoff and evidence package |

## Update protocol
After each tested task record the screen IDs, exact commit SHA, PR, QA URL/job result, deploy URL/SHA, synthetic vs authenticated production/device evidence, remaining acceptance and blockers. Recount V/P/N/B from this register; never change a row to V solely because a PR merged. Only mark V when every applicable check above is evidenced. If the current main changes, recheck the relevant workflow and rollout. Do not duplicate the old 120-scenario ledger in `docs/universal-owner`.

## Next independent actions
1. Finish H14 exact main QA and deploy, then H15/R08 guard QA and release.
2. Run the existing scoped POS R01–R08 tests against current source, then close reproducible workflow gaps (including historical accounting design: historical snapshots are currently intentionally separate from posted live receipts; never silently convert them to ledger entries).
3. Continue R09–R15 and A01–A15 targeted gap audits and acceptance; preserve Customer and Super Admin.
4. Record protected Owner manual/device acceptance separately. Keep real payments, refunds, payouts and destructive actions out of synthetic QA.


### A15 operational handoff — release gates
- Latest verified restaurant changes: main `21f75a18cac940a217d179c078da9bd7252045a3`, QA [44929348404](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44929348404), Pages [44930062941](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44930062941), both successful.
- Accounting release chain: A01–A03 #281 merged `26541cca1ca3f1bb446d6b978f092c557ef19e90`, main QA 44933836979 pending at this checkpoint; A04 #282 browser fixture corrected (new QA required), A05–A07 #283 branch QA 44929782989 passed but merge conflict after #281; A08–A12 #284 pending QA; A13–A14 changes on this branch pending QA. Resolve conflicts against latest main and rerun combined QA; never overwrite earlier fixes.
- For a failed deployment, inspect the exact main SHA and QA evidence, retain the current verified live version, and rerun the matching release only when its guard permits. For missing receipt or interrupted save, inspect the original source and reuse the original request identity where supported; do not re-enter money or blindly retry.
- Before accepting all 45 screens: signed-in owner test at mobile and desktop widths, exact property and role access, date/amount and ledger source reconciliation, Android notifications with screen locked, QR physical scan, print/share, then record evidence in this register. Successful synthetic CI is not a substitute for these checks. No live monetary or destructive testing without explicit transaction authorization.

### Combined accounting release — 2026-11-21
- A01–A03 main `26541cca1ca3f1bb446d6b978f092c557ef19e90`: [QA 44933836979](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44933836979) and [Pages 44934626212](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/44934626212) passed.
- A04–A15 combined branch reconciles #282–#285 against this main. Old branch QA success is not substituted for combined QA. Browser cashbook fixture now supplies the exact count; review check validates explicit owner and restaurant scope. All remaining acceptance stays pending until current release and real owner checks pass.
