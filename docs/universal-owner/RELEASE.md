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

- Baseline **723 Node tests**. Current **736/736 Node regression tests**, frontend/structure/build checks and existing cashbook/delivery PostgreSQL checks passed.
- [Operational QA 43852828203](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43852828203) runs the actual new migrations, real legacy order-field guard surface and all original Owner SQL suites on disposable PostgreSQL 17.
- **97 browser assertions**, zero uncaught page errors, at 360px/390px/1440px. These click actual controllers with explicitly synthetic transport; they are not signed-in production-browser or physical-APK proof. Cases include interrupted/offline checkout, slow loading, returning guests, DND, payer print, cashier dine-in, takeaway, net room discount, closing and audit search.
- [Screenshots, browser evidence and tested Excel workbook](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43852828203/artifacts/14218272969). Fixture screens are labelled synthetic; only runtime files are packaged for Pages.
- Real PostgreSQL concurrency proves one last-room winner, one ledger row for concurrent identical retries, and correct checkout/module-disable exclusion **in both directions**. Existing cashbook and delivery/OTP security suites remain intact.
- The [production rollback-only probe](production_completion_rollback.sql) uses authenticated role/claims and the real existing POS engine. DND denial, discounted source/folio agreement, payer totals, dine-in/takeaway, source-once combined revenue/closing, retries, second-collection denial, audit and cross-tenant/anonymous restrictions were verified. All synthetic rows and temporary configuration changes roll back. No real charge/refund/transfer is initiated.

Testing found and fixed editor mounting, stale POS collection rendering, mobile header contrast/height, DND after a room move and an integration conflict with the production owner-field trigger. The trigger integration was corrected through a separate migration and tested against the real legacy guard; financial-field protection was retained.

## All 120 scenarios

The [JSON ledger](scenarios.json) and [CSV ledger](scenarios.csv) retain each case's role, initial state, route/actions, fields, permissions, money effects, recovery and evidence/limitations.

| Status | Count | Scope |
| --- | ---: | --- |
| PASS | 94 | Only the recorded isolated/browser/rollback scope passed |
| PARTIAL | 17 | Supporting behavior works; the complete case is not certified |
| NOT_RUN | 6 | Complete case remains unexecuted |
| BLOCKED_EXTERNAL | 3 | Actual native/device verification needed |

The six previously absent workflows now have implementation: payer statements, DND, property-cashier POS access, dine-in/takeaway classification, room-food discount and combined closing snapshots. Combined snapshots do **not** lock both department journals together. Other partial scope includes automatic early/late/extra-bed policies, full prescribed foreign-guest compliance, a separate room-service/housekeeping assignment queue, guest-facing hotel refund access, adding another approved outlet, complete multi-device/property-switch testing and merging all legacy restaurant audit scopes. See the individual cases; no blanket “all 120 passed” claim is made.

## Database preservation and release migrations

Applied migrations, in order:

1. `20261116094006_universal_owner_platform`: 13 RLS tables, five authenticated invoker entry RPCs backed by guarded private routines, deliberately public boolean module metadata and existing POS/menu/checkout guards.
2. `20261116104349_owner_operational_completion`: DND/request/payer fields, two RLS tables for tracked staff grants/closing snapshots, authenticated report/audit reads and guarded operational commands.
3. `20261116105700_owner_room_discount_guard`: exact protected-folio proof for initial POS discount/coordinated reversal, integrated with the real existing owner-field trigger.

Repository filenames match the versions returned by the database. Duplicate unapplied filenames were removed. No business history is deleted or reseeded. Five existing property configurations were backfilled; **zero real rooms/stays/folios/guests were invented**.

| Existing data | Before | After verification |
| --- | ---: | ---: |
| Restaurants | 11 | 11 |
| Menu items | 133 | 133 |
| Orders | 101 | 101 |
| Order face value | ₹31,654 | ₹31,654 |
| POS payment records | 10 | 10 |
| Financial snapshots | 94 | 94 |
| Refund jobs | 3 | 3 |

Order digest: `773e1941cd727f4a91519cc403b20816`. Menu digest: `580b079270b8efbd89f1202cadf14f56`. The rollback tests independently check both and the payment/financial counts. These are preservation checks, **not a full database backup**.

Property commands serialize and store request UUID/payload/result for recovery. Current membership, role checks and cross-property keys/RLS protect data. Staff email maps to an existing account; metadata is display-only. Owner-granted cashier/manager membership links to approved owned outlets without overwriting independent existing memberships. Revocation removes only the tracked grant. No invitation or message is sent. Guest scans are not uploaded or publicly served.

Security review found no newly exposed guest/ledger tables. Internal businesses/commands/staff-grant tables intentionally have no browser write policy/grant. The deliberately public boolean function returns no guest/money rows. Existing advisories, including [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), remain explicit platform gates.

Rollback a frontend release using a reviewed revert and the existing exact-SHA QA/Pages process. **Keep all new ledger/invoice/history tables.** Do not drop populated tables or blindly push an earlier local migration version. Older POS screens may offer payment for a room-posted sale; the database still denies the second collection. Retain/restore the new interface to manage hotel folios. Module disabling remains blocked while the server's active stay/balance/deposit/order/refund/checkout checks fail.

## Owner setup and external gates

1. In **Settings → Business Modules**, select the actual property type and review the impact. Existing accounts start Restaurant Only. New hotels use the same app's setup flow.
2. Enter actual room numbers, capacity and agreed rates in **Rooms**. Hotel Maharani Palace's real configuration was not inferred from images or memory.
3. Review GST/rates and invoice requirements with the accountant; statements are not certified statutory tax invoices. Complete applicable foreign-guest reporting through the official process; Bite does not file it.
4. Staff register their own email first. The owner grants the verified exact account and role. Additional restaurant/outlet association still requires approved trusted mapping.
5. Test actual installed Partner APK lock-screen sound, native Accept/Reject, persistent sessions and property-switch notification handoff. Source/synthetic tests cannot certify physical-device behavior.
6. Finish external provider/payment/refund/split-settlement and remaining platform gates separately. No live-money Cashfree test was run for this Owner release.

Final merged SHAs, main QA and verified live Pages deployment are recorded on PR #146 after publication. Describe this as verified staged implementation with the ledger above, not all-workflow, legal/tax or native-device certification.
