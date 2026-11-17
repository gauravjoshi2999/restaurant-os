# Bite Universal Owner — Hybrid Home audit and staged cleanup
Date: 2026-11-17. Baseline: main @ `51e8c339c91b6ee4f8a68c39e0986f34afd2f0da`.
Scope: existing Bite owner UI, preserving the previously selected V3 mobile design.

## Source audit
- `index.html` contains legacy `#overview`, while `assets/owner-premium-shell.js` prepends `#bitePremiumHome`, `assets/owner-hospitality.js` populates `#biteHotelHome`, and `assets/owner-reference-v3.js` prepends `#biteV3Home`.
- On owner mobile widths <=760px, `assets/owner-reference-v3.css` hides other `#overview` children when `bite-v3-active` is set. This is visual suppression, not removal of older logic.
- `assets/owner-capabilities.js` derives available modules from property/business type. `owner-mobile-navigation.js` derives mobile tabs and More from these capabilities. `showPage(id)` and the hospitality route allowlist are authoritative.
- Existing `dashboardSnapshot()` provides hotel `occupied, available, arrivals, departures, cleaning, openFolios`, and verified new food order counts when available. The hotel workspace may be loading; no absent count should be reported as zero.
- `BiteDashboard.summarize()` distinguishes website online net paid vs POS billed face value. Neither equals cash in hand. Do not sum them as collections.
- Owner and super-admin workspaces share `index.html` but have separate role permissions. Keep admin financial reconciliation and provider settlement controls out of the owner navigation.
- Housekeeping visibility is an owner preference. Do not render cleaning count or tools when disabled.

## Canonical destinations
| Destination | Owner action / contents | Home treatment |
| --- | --- | --- |
| Home | Today: actionable approvals/orders, checkouts, arrivals, online net paid, POS billed, room availability | One concise command center; no duplicate full operational lists |
| Hotel > Check-in | New registration, document capture, returning guest | One-tap Check-in |
| Hotel > Reservations | Arrival/check-out stay list and stay management | Priority cards link here |
| Hotel > Rooms | Occupied/available/ready, existing room board | Summary only |
| Hotel > Guest Bills (Folios) | Guest room/food bill and balances | One-tap Guest Bills |
| Hotel > Guests | Guest history, ID review, repeat check-in | Hotel workspace, not redundant Home icon |
| Hotel > Housekeeping | Optional room cleaning workflow | Only when owner enabled |
| Orders | One actionable online order queue, pending confirmation, status/delivery/cancellation | Summary + route only |
| POS | Dine-in/takeaway billing, bill drafts, history, daily/monthly views | One-tap New POS Bill |
| Menu | Food item management and price/availability | Food menu navigation, not Home duplicate |
| More > Tables | Dine-in room/table operations | Optional tool |
| More > Khata | Customer credit and collections | Detailed ledger elsewhere |
| More > Cashbook | Day close, cash/UPI collection reconciliation | Avoid presenting POS billed as collected |
| More > Expenses | Daily business expense recording | Separate view |
| More > Suppliers | Purchases and suppliers | Separate view |
| More > Stock | Inventory and alerts | Separate view |
| More > Staff | Attendance, salary, advances | Separate view |
| More > Reports | Historical charts, daily/monthly trends, exports | Home just today |
| More > Settings | Modules, visibility, delivery zones, owner preferences | Capability-controlled |
| Platform Admin | Tenant approval, provider financials, settlements, security | Never exposed in Owner |

## Work completed in this branch — one reversible UI slice
1. V3 mobile Home now shows departures due and arrivals expected from the existing hotel workspace, if loaded and positive. Both shortcuts open the existing Reservations page; no new database table, RPC or checkout transaction.
2. V3 daily quick actions prioritize Check-in, New POS Bill, Guest Bills and Live Orders when permitted. Guest search and menu remain accessible in their canonical workspaces.
3. New hotel attention presentation inherits the chosen V3 design, scoped to owner mobile only.
4. Added source assertions for permission-aware hotel priority and routing.

## Remaining before calling the entire Home final
- Verify physical Android Owner app and real authenticated hybrid tenant, including narrow screen, keyboard, back/More and one-tap New Bill.
- Confirm server-issued capabilities, hotel-only and restaurant-only login cases; V3 `summary()` currently depends on a restaurant ID and needs a separate hotel-only fallback review.
- Consolidate desktop and mobile visual hierarchy without deleting the premium/legacy code prematurely.
- Verify pending paid order counts against financials, not just status, and avoid any double-counting across room charge/POS/online collections.
- Validate guest checkout navigation and simplify via direct entry only after existing workflow review.
- Show connected/loading/error/zero states independently: absence of data is not proof that no work is pending.
- Performance/accessibility regression and screenshot approval on representative real owner accounts.

## Safety and verification
Presentation-only change; no SQL writes, payment, refund, settlement, guest edit, order status mutation or data deletion.
Branch is intentionally isolated from `main`; merge only after passing pull-request QA and owner visual review.
