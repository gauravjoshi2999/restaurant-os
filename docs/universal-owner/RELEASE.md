# Bite Universal Owner OS — implementation and release evidence

**16 November 2026. This is a staged implementation, not certification of all 120 scenarios or a fully finished hospitality product.** The actual source changes and release status are in [PR #145](https://github.com/gauravjoshi2999/restaurant-os/pull/145). Final main CI, merge SHA and Pages deployment evidence are recorded on that PR after publication.

Source specification: the user's 20-page `BITE_ONE_POWERFUL_WORK_PROMPT_WITH_8_UI_IMAGES(2).pdf`, SHA-256 `1d0bda989f79901a0ff4711aca6ca9ed4bd01c1c633bea035d7f684a2f4c1561`. The 8 references were reviewed as concepts, not imported as real data. See [audit and image interpretation](AUDIT.md).

## Verified before / after

| Area | Before | Implemented and verified |
| --- | --- | --- |
| Application | Existing `index.html` Owner/Admin shell and restaurant workspaces | Same app and router. No separate hotel application |
| Configuration | One restaurant owner context; no hotel tables | Organization/property membership, effective capabilities and role scopes; existing owners backfilled non-destructively |
| Navigation | Restaurant Home / Orders / POS / Menu / More | Restaurant defaults preserved. Hotel/hybrid Home / Register / Rooms / Folios / More; one shared Reports/Staff/Settings destination |
| Setup | Restaurant-only setup | Four-step module review and first-time hotel setup; dependencies and unsafe-disabling checks |
| Front desk | No room/stay/folio backend | Guest lookup/minimal identity, draft/review/check-in, reservations, room assignment, move/extension, pre-arrival correction, group reservations and individual room folios |
| Housekeeping | None | Ready/Dirty/Cleaning/Blocked with role checks. Checkout marks Dirty. Updates poll across sessions; real two-device timing is not certified |
| Folio | None | Room nights, incidentals, advances, partial receipts, pending bank verification/void, deposits/apply/return, manager adjustments and reversals, balanced checkout and immutable invoice snapshot |
| Hybrid food | Existing canonical menu/POS | Explicit room/guest tender; existing POS engine and one folio posting in a transaction; retry deduplication; second POS collection and post-transfer edits denied |
| Shared tools | Existing restaurant reports, employee/payroll records and expenses | Same entries retained. Hotel ledger date filters/real Excel export, method totals, scoped property expenses and registered staff-email access; clear accounting boundaries |
| Marketplace | Existing customer, payment/refund, notification and delivery code | Preserved. Room posting is POS-only. Disabled online module blocks new checkout intents before provider session creation |

Hotel-only manual extras do not depend on restaurant menu/POS. Bank/UPI/card records remain pending until authorized verification. Recording a front-desk transaction does not charge a card or trigger a gateway refund. A linked POS food charge is a folio collection reference; it is not another restaurant sale.

## Tests and actual evidence

- Baseline: **723 Node tests passed** before changes. Final runtime validation: **736/736 Node tests passed**, existing frontend/structure/build checks passed.
- [QA run 43840965237](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43840965237), runtime source `b74bdf0a5d19da3c2ed3b9d434ba5961eae14277`: all four jobs passed — static/browser, existing cashbook PostgreSQL, existing delivery/OTP PostgreSQL, and new Universal Owner PostgreSQL.
- The new browser suite passed **76 assertions** at 360px, 390px and desktop 1440px, with **zero JavaScript page errors**. It uses the actual application controllers with an explicitly synthetic transport. It is not signed-in production/browser or Android hardware proof.
- PostgreSQL 17 tests exercise hotel-only and hybrid accounting, active room conflicts, duplicate commands, pending payments, advance cancellation/refund records, deposits, role/RLS restrictions, coordinated food reversal and module guards. Two simultaneous last-room requests create one stay; concurrent identical charge requests create one ledger entry.
- [Desktop/mobile screenshot and workbook artifact](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43840965237/artifacts/14212314979) includes three dashboards, inner registration/folio/rooms/More/setup/report screens, a hybrid checkout and the tested Excel file. All fixture screens are labelled synthetic.
- Actual production database verification used [this rollback-only test](production_smoke_rollback.sql), with authenticated role/claims and the existing POS engine. Room + food + incidental checkout, repeated receipt/checkout, invoice snapshot, Dirty room, direct second POS receipt denial, cross-tenant RLS/RPC denial and anonymous RPC denial passed. **All synthetic rows and temporary module changes were rolled back. No charge, refund or transfer was initiated.**

Two actual UI bugs were found and corrected through these tests: room editors initially mounted inside an inactive folio; and POS collection state initially rendered before newly posted room links loaded. A screenshot review also corrected the adaptive mobile header's height and text contrast.

## 120-scenario ledger

The structured [JSON ledger](scenarios.json) and [CSV ledger](scenarios.csv) contain all 120 original cases, roles, initial states, routes/actions, fields, permissions, ledger effects, recovery contracts and evidence/limitations.

| Status | Count | Meaning |
| --- | ---: | --- |
| PASS | 72 | Recorded isolated/rollback test scope passed; not blanket live/device certification |
| PARTIAL | 19 | Some supporting behavior works; full case is not certified |
| NOT_RUN | 20 | Complete case has not been executed |
| NOT_IMPLEMENTED | 6 | Dedicated workflow is still absent |
| BLOCKED_EXTERNAL | 3 | Physical-device/native verification required |

The six explicit feature gaps are split-payer invoices for a single stay, dedicated Do Not Disturb, property-cashier access to the legacy POS UI, dedicated dine-in/takeaway entry classification, POS discount allocation across a room folio, and one combined hotel/restaurant shift closing. Additional partial cases include automatic early/late/rate-change policies, a separate room-service fulfilment queue, adding another outlet, full audit search, and guest-facing stay/refund access. Existing owner Counter POS, restaurant closing and marketplace customer refund progress remain available.

## Database, integrity and rollback

Applied database migration: **`20261116094006_universal_owner_platform`**. The repository migration filename matches the version actually returned by the connected database. It adds 13 RLS-enabled tables, five authenticated invoker RPC entry points backed by guarded private routines, a deliberately public boolean module-metadata function, and guards around existing POS/menu/checkout writes. It does not rewrite existing provider functions or delete business history.

After migration, **5 existing property configurations** were backfilled; **0 rooms, stays and folios** were seeded. Existing source snapshots matched before/after exactly:

| Existing data | Before | After |
| --- | ---: | ---: |
| Restaurants | 11 | 11 |
| Menu items | 133 | 133 |
| Orders | 101 | 101 |
| Order face value | ₹31,654 | ₹31,654 |
| POS payment records | 10 | 10 |
| Financial snapshots | 94 | 94 |
| Refund jobs | 3 | 3 |

Order digest: `773e1941cd727f4a91519cc403b20816`. Menu digest: `580b079270b8efbd89f1202cadf14f56`. The rollback integration test independently rechecked the old digests and payment/financial counts. These are preservation checks, **not a full database backup**.

Mutations serialize on the selected property row and store request UUID/payload/result for retry recovery. Cross-property composite keys, current membership checks and scoped RLS protect the new data. Guest scans are not uploaded or publicly served. Staff are assigned by exact registered email, with immediate membership revocation; user-editable metadata is used only for display names.

Security-advisor review found no newly exposed guest/ledger tables. Two new internal tables intentionally have no browser policy/grant. The public boolean function is intentionally callable by anonymous users for menu RLS and returns no guest or financial rows. Existing advisory warnings remain, including [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); this release does not claim all platform advisories are resolved.

Rollback frontend with a reviewed revert of this release and the existing exact-SHA QA/Pages process. **Keep all new tables and financial history.** Do not blindly push the earlier local migration version or drop populated tables. Older POS screens may offer a payment action for a room-posted bill; the new database guard still rejects that second collection. Restore/retain the new interface to manage existing hotel folios. Disabling modules is allowed only after the server's active-stay/balance/deposit/order/refund checks permit it.

## Owner-only setup and remaining release gates

1. Existing accounts start as Restaurant Only to preserve current operations. In **Settings → Business Modules**, select the actual type and review the impact before saving. New hotel accounts use the same app's setup flow.
2. Enter actual room numbers, occupancy and agreed rates in **Rooms**. None were inferred from mockups or memory. Hotel Maharani Palace's real room/rate setup still needs the owner’s confirmed input.
3. Review GST registration/rates with the property's accountant. Unreviewed statements are not certified GST invoices. Complete applicable foreign-guest reporting through the official FRRO process; Bite does not file Form III.
4. Staff first register with their own email, then the owner grants the appropriate property role. Restaurant cashier/outlet provisioning and additional outlet association need completion of the recorded gaps above.
5. Verify lock-screen sound, native Accept/Reject, session persistence and property-switch notification handoff on the actual installed Partner APK. Existing source tests cannot replace this device check.
6. Confirm leaked-password protection and the remaining platform launch blockers independently. No live Cashfree payment/refund/split-settlement test was run for this release.

Release must be described as **core implementation with the explicit ledger above**, not as “all 120 passed,” “all workflows production-ready,” or a completed legal/tax/native-device certification.
