# Bite Owner Portal — source audit and canonical mobile IA (pass 1)
Date: 2026-11-14. Branch: `refactor/owner-canonical-nav-20261114`. Scope: **owner UI only**. No live Supabase mutation, API changes, or route deletion.

## Actual stack (verified)
- Static single-page owner/super-admin workspace: `index.html` (~484 KB including inline controller). Public pages `customer.html`, `delivery.html` are separate; deployed with GitHub Pages from `main` through `.github/workflows/deploy.yml`.
- Owner navigation: `assets/owner-mobile-navigation.js` and `.css`; document/sidebar scrolling `assets/owner-layout.css`; `showPage(id)` in `index.html`; page activation and financial helpers `assets/owner-core.js`; home KPIs `assets/owner-dashboard.js`.
- POS: `index.html`, `assets/bite-pos-drafts.js`, `assets/bite-pos-payment-safety.js`, `assets/bite-pos-payment-ui.js`. Menu and options: `index.html`, `assets/owner-menu-options.js`. Cash closing: `index.html`, `assets/owner-cash-closing.js`.
- Backend: Supabase PostgreSQL/Auth/RLS and RPC, no separate Next.js router in the current served owner client. Android app behavior needs independent hardware verification: changing web UI does not automatically verify APK navigation/notifications.
- There is no root `package.json` in the current repository; JS tests run with Node 22 built-in runner, browser smoke with Python Playwright/Chromium, database fixture with PostgreSQL 17.

## Routes/pages actually found
`showPage` explicitly allows **13 owner destinations**:
`overview`, `orders`, `pos`, `menu`, `tables`, `khata`, `cashbook`, `expenses`, `purchases`, `inventory`, `hr`, `reports`, `settings`.

Super Admin-only destinations: `overview`, `restaurants`, `orders`, `reconciliation`, `financials`, `audit`, `support`, `moderation`, `customers`, `storefront` (separate role, overlaps overview/orders by design). `refunds` exists as a legacy DOM page, but is **not** permitted by `showPage`; do not delete without dependency review. All of these are DOM section IDs, **not HTTP API routes**.

Current owner mobile shell before this PR: Home / Orders / **New Bill** (automatically opens bill modal) / **Kharcha** / More (opens full sidebar). Same Home, Orders and POS appear in the full owner drawer; user reports scattered/duplicated navigation.

## Canonical feature map and decisions
| Feature | Existing evidence / data model | Decision | Canonical owner destination |
|---|---|---|---|
| Home KPI | `assets/owner-dashboard.js`, `overview` | KEEP | Home; summary-only, actions link to canonical screens |
| Order lifecycle, details, rejection | `orders`, `orders`, `order_items`, status history, owner notification/OTP RPCs | KEEP + eventually MERGE secondary order queues | Orders; details/modal, no parallel duplicate list |
| Delivery handoff | `create_delivery_handoff` RPC, `restaurant_delivery_handoffs`, `delivery.html` | CONDITIONAL; preserve existing handoff | Within Orders, do not invent a rider-management system |
| POS, saved bills, payments | `pos`, `orders`, `restaurant_order_payments`, `restaurant_pos_drafts` | KEEP; switch tab to workspace not auto-new bill | POS; New Bill remains explicit button; Home shortcut remains intact |
| Table service | `tables`, `restaurant_tables` | MOVE (reversible) | More > Tables; avoid fabricating floor plan |
| Menu / item availability / variants | `menu`, `menu_items`, `menu_categories`, `menu_item_option_groups`, `menu_option_groups`, `menu_option_choices` | KEEP | Menu |
| Inventory | `inventory`, `restaurant_inventory_items` | MOVE; not merge ledgers into menu tables | More > Stock |
| Expenses | `expenses`, `restaurant_expenses` | MOVE | More > Kharcha |
| Cashbook/day close | `cashbook`, `restaurant_cashbook_closings`, `restaurant_cashbook_entries`, cashbook RPC | KEEP separate finance ledger | More > Cashbook |
| Customer khata | `khata`, `restaurant_customer_ledger_entries` | KEEP | More > Khata |
| Purchases/suppliers | `purchases`, `restaurant_purchases` | KEEP | More > Suppliers |
| HR/attendance/payments | `hr`, `restaurant_employees`, `restaurant_employee_attendance` | KEEP | More > Staff |
| Business reports | `reports`, existing reporting code | KEEP | More > Reports; Home only top-line snapshot |
| Owner settings/delivery zones | `settings`, `restaurant_delivery_zones` | KEEP | More > Settings |
| Reviews | `restaurant_reviews`, `respond_restaurant_review` RPC; loaded from Orders workspace today | MOVE later after backend/UI dependency audit | More > Reviews (planned; not implemented here) |
| Settlements/platform reconciliation | `reconciliation`, `financials` are Super Admin routes; `restaurant_settlements` exists | CONDITIONAL | Do not expose admin-only financials as owner finance |
| Marketplace offers/ads | `storefront` is Super Admin route; no verified owner ads API | CONDITIONAL | No dummy toggles; research owner capabilities first |
| Zomato/Swiggy channel integrations | Strings in code are not proof of provider API integration | CONDITIONAL | Never show fake connected on/off switches |
| Kitchen tickets/KOT | No user-facing KOT UI found in audited `index.html` | SKIP/REMOVE from proposal only | No KOT page, print KOT, or Send to Kitchen button |

Important: **Bite online orders are online-payment-only (no COD)**. Do not copy sample screenshots' COD amounts into production logic. Existing POS payments are separate and may include Cash/UPI. Avoid invented amounts and metric double counting.

## Read-only database catalog check
Core real `public` tables verified: `orders`, `order_items`, `restaurant_order_payments`, `restaurant_order_refunds`, `restaurant_tables`, `menu_items`, `menu_categories`, `restaurant_expenses`, `restaurant_cashbook_closings`, `restaurant_purchases`, `restaurant_inventory_items`, `restaurant_employees`, `restaurant_employee_attendance`, `restaurant_reviews`, `restaurant_delivery_handoffs`, `restaurant_delivery_zones`, `restaurant_members`, `restaurant_settlements`, `restaurant_pos_drafts`. Their catalog RLS flag is enabled. Cashbook entries are a read-only `security_invoker=true` view, not a table; migrate cautiously. Catalog RLS enabled is not a complete authorization test; role-by-role checks remain open.

## Functional/data risks discovered
1. `assets/owner-dashboard.js` computes home marketplace sales from own-platform website orders; POS sales have a different financial path. Avoid labeling this figure total all-channel sales without reconciling both sources and settled/refunded state.
2. One-page inline controller has many owner + admin loaders; extracting or deleting a DOM page can silently break loader references. No page or handler deletion in Phase 1.
3. Owner `showPage` currently only grants the 13 owner screens, while Super Admin uses a separate allowlist; do not expose staff-specific tabs without explicit role policies.
4. `restaurant_delivery_handoffs` and OTP flow exist; no verified first-party rider roster/assignment model in audited owner code. Do not invent rider IDs or ETA.
5. KOT screen is absent. Avoid adding KOT actions in POS based solely on competitor examples.
6. PR #25 integrated existing mobile shell and cashbook UI; planned cashbook day-serialization SQL remains unapplied to production, independent of this UI refactor.

## Phase 1 implemented in this Draft PR
- Single owner mobile bottom bar: **Home / Orders / POS / Menu / More** (5 labelled destinations).
- POS tab routes to existing `showPage('pos')` rather than creating a draft implicitly; existing Home `openPosFromOverview` quick-bill function remains.
- Mobile **More** drawer excludes only the four primary route buttons *visually*. Existing DOM elements, event listeners, desktop sidebar and admin workspace are unchanged. Expenses/Cashbook/Khata/Purchases/Tables/Stock/Staff/Reports/Settings remain reachable via More.
- Remove duplicate top hamburger in owner mobile view (More still opens drawer), deep-purple owner header, white bottom bar and purple active state. No backend/API/DB changes.
- Update Node and synthetic Chromium smoke for 320/390/430/1024 px, role guards, navigation history, More and POS behavior.

## Next phases / release gates
- **Phase 2**: Order states and detail presentation; avoid duplicated actionable order queues between Home and Orders. Need actual Android owner screenshot to review visual hierarchy; mock browser cannot verify installed APK.
- **Phase 3**: POS search/billing, Table and Menu screens; verify real tenant/auth, payment split only with supported backend. Do not change database/POS payment contract.
- **Phase 4**: Home consolidated truthful KPIs + concise trend, then More finance/HR/reviews as supported. Separate marketplace and POS totals, demo and refunds explicitly.
- **Phase 5**: Real Android Owner login, notification/lock-screen actions, workflow QA, Cashfree/OTP, cross-restaurant RLS. No live payment transactions without controlled authorization.
- **Destructive approval gate**: Request explicit owner confirmation before physically deleting legacy `refunds` DOM, merging backend ledger tables, moving review RPCs, or removing any active route/permission. The Phase 1 changes are reversible presentation-only.
