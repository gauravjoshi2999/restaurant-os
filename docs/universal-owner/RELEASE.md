# Bite Universal Owner OS — implementation and release evidence

**16 November 2026. The existing Bite app has been implemented and released in verified stages. This is not certification of all 120 scenarios or a fully finished hospitality product.** Code, published SHAs, final main CI and exact-SHA Pages deployment evidence are recorded in [core PR #145](https://github.com/gauravjoshi2999/restaurant-os/pull/145) and [operational completion PR #146](https://github.com/gauravjoshi2999/restaurant-os/pull/146).

Source: the user's 20-page `BITE_ONE_POWERFUL_WORK_PROMPT_WITH_8_UI_IMAGES(2).pdf`, SHA-256 `1d0bda989f79901a0ff4711aca6ca9ed4bd01c1c633bea035d7f684a2f4c1561`. All 120 cases and 8 references were reviewed. References are design concepts, not real room numbers, rates, guest or tax data. See [the audit](AUDIT.md).

## Actual changes

| Area | Implemented in the existing application |
| --- | --- |
| Shared shell | Existing `index.html` Owner/Admin router, adaptive Restaurant / Hotel / Hybrid capabilities, shared Settings/Reports/Staff and scoped property switch. Customer/delivery entry points stay linked to original records |
| Setup | Four-step module review, first-time hotel setup, dependencies and unsafe-disabling checks. Existing accounts remain Restaurant Only until the owner reviews their actual configuration |
| Front desk | Returning guest lookup, minimal identity, scoped draft/review/check-in, reservations/corrections/no-show, room reassignment/move, manager-priced extensions, group bookings and separate room folios |
| Housekeeping | Ready/Dirty/Cleaning/Blocked, inspected readiness, DND and stayover cleaning request flags. DND prevents starting cleaning, follows a moved guest and clears on checkout. Checkout marks Dirty |
| Guest ledger | Itemized nights/incidentals, partial/advance receipts, pending bank verification, deposits/apply/return, authorized reversals/discounts, balanced checkout and immutable statement snapshots |
| Payer split | Two itemized charge-allocation statements, partitioned in paise, on one settled folio. Shared receipts remain on that one folio. These are not certified separate statutory tax invoices |
| Existing POS | Explicit room/guest tender uses the canonical POS engine and one atomic folio posting. Cashier access uses scoped staff membership. Dine-in/takeaway Pay Now, optional dine-in table, manager-approved room-food discount and original owner Counter POS are retained |
| Money integrity | Direct second POS collection/post-transfer edits denied. Initial room discount must match the protected open-folio source entry exactly; no client-settable bypass. Coordinated source reversals retain the original sale/history |
| Reports | Hotel Excel/date/method reports, source-deduplicated combined sales and money methods, immutable combined closing snapshots with later-entry warnings, paginated property audit search and scoped property expenses |
| Marketplace | Existing customer checkout, Cashfree/refund/provider, delivery/OTP, notification and Android source preserved. Module cutoff and checkout intent creation serialize before provider session creation |

Hotel-only manual extras do not depend on restaurant menu/POS. Folio UPI/card/bank records stay pending until authorized verification. Recording a front-desk receipt/refund does not charge a card or initiate a gateway refund. Room-posted food is an existing POS sale and one folio collection reference.

## Verification and evidence

- Baseline **723 Node tests**. Current **747/747 Node regression tests**, frontend/structure/build checks and existing cashbook/delivery PostgreSQL checks passed.
- [Operational QA 43852828203](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43852828203) runs the actual new migrations, real legacy order-field guard surface and all original Owner SQL suites on disposable PostgreSQL 17.
- **176 recorded browser assertions at runtime QA 43869216519 (97 original + 79 operational)**, zero uncaught page errors, at 360px/390px/1440px. These click actual controllers with explicitly synthetic transport; they are not signed-in production-browser or physical-APK proof. Cases include interrupted/offline checkout, slow loading, returning guests, DND, payer print, cashier dine-in, takeaway, net room discount, closing and audit search.
- [Screenshots, browser evidence and tested Excel workbook](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43852828203/artifacts/14218272969). Fixture screens are labelled synthetic; only runtime files are packaged for Pages.
- Real PostgreSQL concurrency proves one last-room winner, one ledger row for concurrent identical retries, and correct checkout/module-disable exclusion **in both directions**. Existing cashbook and delivery/OTP security suites remain intact.
- The [production rollback-only probe](production_completion_rollback.sql) uses authenticated role/claims and the real existing POS engine. DND denial, discounted source/folio agreement, payer totals, dine-in/takeaway, source-once combined revenue/closing, retries, second-collection denial, audit and cross-tenant/anonymous restrictions were verified. All synthetic rows and temporary configuration changes roll back. No real charge/refund/transfer is initiated.

Testing found and fixed editor mounting, stale POS collection rendering, mobile header contrast/height, DND after a room move and an integration conflict with the production owner-field trigger. The trigger integration was corrected through a separate migration and tested against the real legacy guard; financial-field protection was retained.

## All 120 scenarios

The [JSON ledger](scenarios.json) and [CSV ledger](scenarios.csv) retain each case's role, initial state, route/actions, fields, permissions, money effects, recovery and evidence/limitations.

| Status | Count | Scope |
| --- | ---: | --- |
| PASS | 113 | Only the recorded isolated/browser/rollback scope passed |
| PARTIAL | 3 | Supporting behavior works; the complete case is not certified |
| NOT_RUN | 1 | Complete case remains unexecuted |
| BLOCKED_EXTERNAL | 3 | Actual native/device verification needed |

The executable web workflows now include reviewed arrival/checkout policies, prepaid registration, assigned service queues, guest-facing hotel refund/bill access, approved additional outlets, staff/property handoff, combined journal locking and unified audit search. Seven cases remain explicitly limited: foreign reporting (A009), native cross-outlet notifications (A107), guest-document storage (A108), an actual Android keyboard (A111), lock-screen sound/actions (A072/A073) and cross-device sessions (A115). No blanket “all 120 passed” claim is made.

## Operational extension — PR #147

[PR #147](https://github.com/gauravjoshi2999/restaurant-os/pull/147) contains the additional work in the same Owner and Customer apps. [Runtime QA 43869216519](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43869216519) passed all four jobs on head `f3bb86412d1499a6ef980c339e3d96c1c9ad52b5`; its [176-check browser/PDF evidence](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43869216519/artifacts/14227190977) uses synthetic transport. Final PR QA reruns the source and adds a print-edge assertion after visual PDF inspection. The final deployment SHA/status is reported from the actual merged PR, Actions runs and live build endpoint, never inferred from a source commit.

- **Policies:** server-priced review before registration, manual external/prepaid reference, atomic once-only booking advance, pending bank verification, policy snapshots, early-arrival fee, unused-night credit, late fee/grace/cap/tax and approved late-time/waiver with incoming-arrival conflict protection. Old stays keep their original clock metadata and no new automatic fees. Only reviewed future reservations adopt the new terms.
- **Queues:** assigned housekeeping with DND and supervisor inspection; room-service preparing/ready/delivered tracks the existing POS sale and guest folio once. Unfinished service blocks checkout. Two browser sessions automatically refresh through the actual polling controller.
- **Guest access:** 72-hour bearer bill/refund links, only hashes at rest, one folio per token, rotation/revoke/expiry, masked return references and no guest identity/address/bank-account exposure. Owner return progress requires verification and appends exactly one refund entry. Forms record front-desk money; they do not initiate a transfer or a gateway refund.
- **Association:** actual pending restaurant applications reuse existing Admin approval and profile-change requests. Approved verified outlets attach without publishing themselves. Verified shared-owner portfolios are protected from destructive conflict resolution; shared password reset needs an explicit all-outlet acknowledgment. Edge Function `reset-restaurant-owner-password` version **8** is ACTIVE with JWT verification retained. No real account password was reset by QA.
- **Closing/audit:** review-only snapshots remain compatible. An explicit lock covers both hotel and seven restaurant cashbook sources, rejects stale concurrent reviews and permits later-day corrections. Marketplace payment activation is exempt. A scoped audit search joins property, existing restaurant operations and relevant platform actions.

The [production rollback-only probe](production_remaining_rollback.sql) passed against the real POS engine: once-only advance/credit/return record, service queue, guest-link privacy/revoke, Hotel Only → Hybrid preserves an occupied guest folio, approved outlet attachment, and both hotel/POS journal locks. Every synthetic row and configuration change rolled back. This is neither a real-money test nor physical-device certification.

## Database preservation and release migrations

Applied migrations, in order:

1. `20261116094006_universal_owner_platform`: 13 RLS tables, five authenticated invoker entry RPCs backed by guarded private routines, deliberately public boolean module metadata and existing POS/menu/checkout guards.
2. `20261116104349_owner_operational_completion`: DND/request/payer fields, two RLS tables for tracked staff grants/closing snapshots, authenticated report/audit reads and guarded operational commands.
3. `20261116105700_owner_room_discount_guard`: exact protected-folio proof for initial POS discount/coordinated reversal, integrated with the real existing owner-field trigger.
4. `20261116135719_owner_remaining_workflows`: additive policy/service/refund/link/checklist/application tables and guarded APIs; approved portfolio association, journal locks and unified audit. Applied successfully; file contents retain SHA-256 `e571e44da56357385eea2f58898517fa1fb3cf5f91adb058b4fec748f9280240`.

Repository filenames match the versions returned by the database. Duplicate unapplied filenames were removed. No business history is deleted or reseeded. Five existing property configurations were backfilled; **no sample rooms/stays/folios/guests were retained by implementation or QA**. At the later operational release, the live system contained 3 rooms, 1 stay, 1 folio and 1 guest; these original records were preserved.

| Existing data | Before | After verification |
| --- | ---: | ---: |
| Restaurants | 11 | 11 |
| Menu items | 133 | 133 |
| Orders | 101 | 101 |
| Order face value | ₹31,654 | ₹31,654 |
| POS payment records | 10 | 10 |
| Financial snapshots | 94 | 94 |
| Refund jobs | 3 | 3 |

Order digest: `773e1941cd727f4a91519cc403b20816`. Menu digest: `580b079270b8efbd89f1202cadf14f56`. The rollback tests independently check both and the payment/financial counts. The later upgrade also preserved the original hotel-row digest `a3eae97a65d6ae33ae33f65a61ab1850`, excluding only newly added metadata columns. These are preservation checks, **not a full database backup**.

Property commands serialize and store request UUID/payload/result for recovery. Current membership, role checks and cross-property keys/RLS protect data. Staff email maps to an existing account; metadata is display-only. Owner-granted cashier/manager membership links to approved owned outlets without overwriting independent existing memberships. Revocation removes only the tracked grant. No invitation or message is sent. Guest scans are not uploaded or publicly served.

Security review found no newly exposed guest/ledger tables. Internal businesses/commands/staff-grant tables intentionally have no browser write policy/grant. The deliberately public boolean function returns no guest/money rows. The added hash-only link table intentionally has no browser policy/grant; the token-scoped reader intentionally uses SECURITY DEFINER for anonymous guest access. Security advisories changed from 8 to 9 no-policy INFO findings, 6 to 7 anonymous SECURITY DEFINER warnings and 53 to 54 authenticated warnings, exactly for these reviewed surfaces. Existing advisories, including [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), remain explicit platform gates.

Rollback a frontend release using a reviewed revert and the existing exact-SHA QA/Pages process. **Keep all new ledger/invoice/history tables.** Do not drop populated tables or blindly push an earlier local migration version. Older POS screens may offer payment for a room-posted sale; the database still denies the second collection. Retain/restore the new interface to manage hotel folios. Module disabling remains blocked while the server's active stay/balance/deposit/order/refund/checkout checks fail.

## Owner setup and external gates

1. In **Settings → Business Modules**, select the actual property type and review the impact. Existing accounts start Restaurant Only. New hotels use the same app's setup flow.
2. Enter actual room numbers, capacity and agreed rates in **Rooms**. Hotel Maharani Palace's real configuration was not inferred from images or memory.
3. Review GST/rates and invoice requirements with the accountant; statements are not certified statutory tax invoices. Complete applicable foreign-guest reporting through the official process; Bite does not file it.
4. Staff register their own email first. The owner grants the verified exact account and role. In Settings, submit the outlet application or connect an already approved, owned outlet. The existing Admin approval/publication process remains authoritative.
5. Test actual installed Partner APK lock-screen sound, native Accept/Reject, persistent sessions and property-switch notification handoff. Source/synthetic tests cannot certify physical-device behavior.
6. Finish external provider/payment/refund/split-settlement and remaining platform gates separately. No live-money Cashfree test was run for this Owner release.

Final merged SHAs, main QA and verified live Pages deployment are recorded on the corresponding PR #145/#146/#147 and their Actions runs. The live `bite-deploy-version.json` exposes the deployed SHA for exact comparison. Describe this as verified staged implementation with the ledger above, not all-workflow, legal/tax or native-device certification.
