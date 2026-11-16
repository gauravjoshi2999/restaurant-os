# Universal Owner OS — verified baseline, 16 November 2026

Master: the user's 20-page `BITE_ONE_POWERFUL_WORK_PROMPT_WITH_8_UI_IMAGES(2).pdf`. It supersedes older restaurant-only exclusions for this implementation. The customer marketplace remains online-payment-only.

## Verified source and infrastructure

Baseline commit: `9d8be73c12f216c3755867e8cbee399c20a890a5`. GitHub QA run 43817268771 and Pages deploy 43817445875 succeeded on that SHA. Local static checks and **723 Node tests passed before edits**. Browser checks initially could not find Playwright's bundled Chromium; system Chromium is available and will be used for local verification.

The project is static HTML/JavaScript, not the previously proposed Next.js app. `index.html` owns authentication, role checks, page routing, data loading, POS and shared workspaces. `customer.html`, `delivery.html`, the QR pages, Android patcher, Cashfree Edge Functions and existing SQL are retained. Public deployment packages only runtime assets. There were no hotel, room, stay or folio tables in the connected Postgres 17 project. All 65 existing public tables had RLS enabled. There are 11 restaurant records, 133 menu items and 101 orders at baseline (counts are snapshots, not backups).

Authentication explicitly rejected multiple restaurant memberships and staff logins. `has_restaurant_role` excludes platform administrators. Existing restaurant IDs and membership mappings must remain authoritative for existing restaurant operations. Add property membership alongside them; do not manufacture restaurant memberships for housekeepers/receptionists or broaden platform administrator write access.

## Capability and route migration map

| Capability | Decision | Existing/new route and component |
| --- | --- | --- |
| Customer cart, checkout, Cashfree verification/refunds | KEEP | `customer.html`, existing Edge Functions and payment ledger |
| Orders, notification queue, accept/reject, delivery OTP | REUSE | `index.html` orders; existing push/burst/workspace modules |
| POS, menu, drafts, quantities, WhatsApp receipt | REUSE/IMPROVE | existing POS/modal and menu; explicit optional room posting |
| Reports, expenses, staff, settings | REUSE | one shared navigation entry per existing route; hotel report section in Reports |
| Property/modules/roles | ADD | `business-modules` within the existing app, server-scoped property context |
| Register, reservations, rooms, guests, folios, housekeeping | ADD | existing `showPage` shell and shared owner assets |
| Guest supporting copies | OPTIONAL PRIVATE | Guests → Private copies: redacted JPEG/PNG/PDF, scoped front-desk access, no-store server downloads and confirmed removal. No public/bearer URLs or mandatory scan collection |
| Fake aggregator widgets, mock revenue, repeated billing tiles | REMOVE FROM DESIGN | No new fake integrations or second restaurant billing engine |

## Eight reference audits

The references are concepts, not verified datasets. Their dates, totals, partner URLs and aggregator badges are not imported.

| Reference | Element-by-element interpretation and destination | Correction/states |
| --- | --- | --- |
| 1 restaurant desktop | Dark sidebar → current owner nav; property selector → authorized contexts; order queue/status → Orders; POS summary → existing POS; menu shortcuts → Menu; sales chart → verified existing reporting; activity → audit | No hotel links or redundant Add Charge. Keep loading/empty/error states and actual payment labels. No Swiggy/Zomato claim |
| 2 hotel desktop | Register → guest search/check-in review; Assign Room → room selection in reservation; Add Charge → folio; Check-Out → folio settlement; occupancy/ready/dirty/blocked → real room/stay data; arrivals → reservations; housekeeping → room status actions; pending bills → folios | Occupied and cleaning are separate dimensions. A checkout marks Dirty. Do not use 50-room example data; inspect/ready required before assignment |
| 3 hybrid desktop | One header/sidebar; hotel actions above; food queue → existing Orders; restaurant summary → existing POS; revenue split → Reports; mixed activity → property audit | Exactly one Reports/Staff/Settings. POS food enters combined sales once; room folio is collection, not another food sale |
| 4 onboarding | Business type cards → step 1; relevant name/address/contact → step 2; module dependencies and navigation → step 3; review/save → step 4; Back/Continue → preserve draft | Existing owners review existing settings without registering again. New restaurant publication still needs the existing onboarding approval. No fictional vendor connections |
| 5 architecture board | Three types → defaults; shared Reports/Staff/Settings → existing routes; dependency chips → server validation; flow A/B/C/D → scenario ledger | Type is not an authorization role. Effective capabilities depend on property membership and server configuration |
| 6 hybrid mobile | Compact header/property selector; hotel register/rooms/folios tabs; More → enabled Orders/POS/Menu/shared tools; global live-order warning → Orders; room status → Rooms; activity → audit | Keep order alert visible outside restaurant pages. Replace dense phone table and giant photo with cards and 44px actions. More stays inline |
| 7 hotel mobile | Home/Register/Rooms/Folios/More; arriving guests → reservation detail; room cards → housekeeping; folio badge → outstanding balance; check-in → draft/review/confirm | No restaurant menu dependency for water/laundry. Keyboard can scroll forms; offline draft never says Checked In |
| 8 restaurant mobile | Retain Home/Orders/POS/Menu/More; live queue → existing status flow; stock/menu → existing routes; restaurant sales → existing real summary | No hotel prompts on restaurant Home. Configure modules lives in Settings; no second restaurant-charge screen |

Every new action has loading, server-denied, error/retry and confirmed result states. Informational metrics are not styled as buttons. Invoice preview/print has no ledger mutation. Search does not expose guest IDs to restaurant-only staff.

## Sources and design decisions

Cloudbeds' [reservation folio documentation](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/49527551635355-Reservation-Details-Overview-and-Folio-actions) describes booking context and folio actions in one panel. Its [POS pay endpoint](https://developers.cloudbeds.com/v1.2/reference/payorder) distinguishes room posting from other tenders and documents posting retries. These inform our coherent folio and idempotent posting; Bite has no Cloudbeds integration.

Supabase [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) was checked together with the current changelog. New data is private by default, with property/role predicates and no browser direct financial writes. Privileged internal routines are in `private`, authenticate explicitly and pin `search_path`.

Tax rates are not copied from images. The older CBIC summary conflicts with the [16 September 2025 Ministry of Finance FAQ](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=2167151&lang=2&reg=48) and [Notification 15/2025](https://taxinformation.cbic.gov.in/view-pdf/1010456/ENG/Notifications). Property tax configuration requires explicit review; this release must not call an unconfigured statement a GST tax invoice. Foreign-guest rules also changed: [official October 2026 notice](https://dipr.mizoram.gov.in/post/compliance-with-the-immigration-and-foreigners-act-2025-and-the-protected-area-permit-requirements-in-respect-of-foreign-nationals-staying-in-accommodation-units-regarding) describes Form III (earlier Form C) and the FRRO portal. Bite must show a manual compliance reminder, not claim filing integration or legal completeness.

## Protection and rollback

Work on a dedicated feature branch. New tables/RPCs are additive; no existing payment rows, orders, menus, IDs or provider functions are rewritten. Legacy restaurant configurations are backfilled using their current owner mappings. No sample rooms or guests are retained in production. The later private-copy API probe creates and removes its own synthetic property/guest/accounts. No real money test is authorized. A schema/count preflight is evidence only, not a full database backup. Financial test fixtures belong in ephemeral Postgres. Roll back frontend by reverting the release commit; leave new ledger/history intact. Disable unused hotel modules only with no open stays/balances/deposits. Do not drop populated tables to roll back.

Known baseline advisories include leaked-password protection disabled, intentionally private RLS tables with no browser policy and publicly callable guarded/intentional SECURITY DEFINER APIs. Do not remove required delivery/storefront functions to silence advisories. The new functions need their own role/tenant/anonymous tests.
