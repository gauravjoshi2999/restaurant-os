# Bite Super Admin workspace

Implements the approved eight-page Canva reference `DAHbPJAtG9w` within the existing Owner/Admin application. The three primary destinations are Home, Restaurants and Payments. More exposes platform orders, commission, customer support, reports, audit, customer controls, review reports and website offers. No separate Admin account or role is provisioned.

Restaurant approval, publishing, pause and change requests use a server-verified, row-locked review RPC with an expected update timestamp. Approval requires contact details, an available menu and pickup or an active delivery zone with pincodes. Approval and publishing are separate actions. Existing Owner creation, reset, mapping, verification documents and change-request workflows remain available in management tools.

Overview counts and delayed/unassigned attention pagination are authoritative database reads. Orders, payments, refunds and settlements use bounded lists with real detail records. Provider checks reuse `bite-cashfree-operations`; browsing does not initiate refunds or transfers. Collection, recorded restaurant payable and bank payout remain separate states. Unknown actual gateway fees remain unknown.

Commission updates use a server-verified, audited RPC with optimistic concurrency and optional restaurant inheritance. Only future checkout snapshots use the changed configuration. No existing checkout, financial snapshot or provider record is rewritten. Reports reuse the existing India-date business metrics RPC and can export the displayed period as CSV.

New UI, header, navigation and table-card styles are scoped to Super Admin. Owner property operations, customer ordering and the existing payment execution rules are retained. Live order changes refresh the visible platform list; visible monitoring screens also refresh each minute without calling provider operations.

Validation:

- `scripts/check_frontend.py`, Owner structure checks, 854 Node regressions and 10 Python unit tests.
- `scripts/super_admin_db_test.sql` on isolated PostgreSQL: anonymous/Owner/staff denial; India-day boundaries; demo/POS exclusion; exact pagination; incomplete onboarding; approval/publishing; concurrent updates; commission limits/inheritance; unchanged snapshots; actor audit events.
- `scripts/super_admin_browser.py` uses production controllers and synthetic transport at 320, 360, 390, 430 and 1440px. Exercises matching attention detail, search, pagination, review actions, commission conflict, payment/refund checks, provider failure, support save, audit history, report download, backend failure/retry and Owner route isolation. CI produces screenshots and JSON evidence.
- Existing Chromium Owner/customer suites and the ledger, delivery and Owner PostgreSQL jobs remain mandatory release gates.

The browser suite does not log into real customer accounts, collect money, execute refunds or send bank payouts. Production verification checks the deployed source version, public login/customer flows and the database permission boundary separately.
