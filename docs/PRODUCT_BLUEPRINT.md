# Bite — Eat. Repeat. | Product Blueprint & Delivery Roadmap

**Document status:** Approved requirements baseline from the 120-question product interview  
**Current delivery focus:** Restaurant operations and ordering only  
**Future scope:** Hotel module is intentionally deferred; the long-term platform may support Restaurant, Hotel, Cafe, Bakery and Cloud Kitchen business modules.

## 1. Product vision

Bite is a responsive, multi-tenant restaurant business platform. It connects a restaurant's own customer ordering website, dine-in/counter/takeaway sales, and (subject to authorized partner access) Zomato and Swiggy orders in one owner workspace. It also provides the restaurant's day-to-day operating tools: billing, cashbook, purchases, stock, staff, customer records, reporting and branch oversight.

The first release is a restaurant product. Hotel room bookings, guest folios and housekeeping are not part of the current build.

## 2. Users and access

- **Platform Super Admin:** one initial administrator account, securely provisioned; platform-wide onboarding, subscription, support, oversight and company reporting. All privileged support actions must be audited. Financial actions require appropriate approvals.
- **Restaurant Owner:** owns one business account; manages its profile, branches, staff permissions, orders, cash closing, expenses, menu, stock, purchases, reports and business settings.
- **Manager:** only the capabilities explicitly granted by the Owner; may manage day-to-day operations and order status, but cannot perform Owner-only controls such as expense entry or daily cash closing unless a future permission explicitly grants it.
- **Staff:** limited, configurable access; may create permitted orders, but cannot manually create Zomato/Swiggy orders.
- **Customer:** browses published restaurants and menus, places online orders, sees their own order history and tracks order status.

A business account may contain multiple branches and optional modules. Each branch has separate operational records and a combined Owner dashboard. The Owner has one business account; separate businesses are not silently merged.

## 3. Order channels and workflow

All channels appear in one order workspace with clear channel labels and filters:
1. RestaurantOS customer website.
2. Zomato.
3. Swiggy.
4. Offline POS: counter sale, takeaway, dine-in, table order and walk-in customer.

Order board uses attractive cards and lanes. New orders generate a live dashboard alert and sound. The Owner manually accepts or rejects and manually advances the status; no automatic timeout or kitchen display/KDS is required. The selected lifecycle is Received → Accepted → Preparing → Ready → Handed Over → Completed, with Rejected/Cancelled outcomes and reason/history. Customers see a live status timeline and an estimated fulfilment time when available.

The restaurant manages its own delivery/pickup. RestaurantOS does not operate a delivery fleet in the initial model. The Owner may choose to share delivery location when applicable. Customer cancellation after acceptance is a request for Owner approval; the Owner records approval/rejection, reason and refund details.

**Explicit exclusions:** no KOT workflow, no KOT printer, and no kitchen screen.

### External platform integration safeguards
Zomato/Swiggy order ingestion, menu sync and status updates are dependent on authorized partner/API access and platform approval. Until approved, use a clearly labelled manual fallback. Only the Owner may manually enter an external-platform order. When APIs recover, reconciliation must prevent duplicate orders. Never represent a manual entry as an automatically received API order.

## 4. Customer ordering website

- Restaurant discovery by location, search, categories, filters and favourites.
- Restaurant pages with menu photos, descriptions, prices, veg/non-veg markers, categories, ratings/reviews, customization, add-ons, offers and availability.
- Cart, customer contact/address details, online checkout and customer order history.
- Customer account/session should reduce repeated entry of details, without requiring SMS OTP in the currently selected checkout flow.
- Live order timeline, status timestamps and ETA; customer sees only their own orders.
- Reviews: stars, written review, food photos, Owner reply, report and moderation.
- CRM: customer contact, order history, spend, last order, favourites, feedback, notes, groups and offers.
- Marketing: coupons, loyalty, referrals, membership, personalized offers and campaigns. Campaign delivery must respect consent, opt-outs and applicable messaging rules.

## 5. Payment, commission and settlement policy

- Customer payments on the RestaurantOS website are intended to use an appropriately authorized payment-aggregator/marketplace settlement structure.
- Proposed own-platform commission: **18%** on the agreed commissionable food value. The agreed base, discount treatment, tax, gateway fees, refunds and settlement deductions must be specified in signed agreements before launch.
- Zomato/Swiggy order-management commission from RestaurantOS: **0%**. Those platforms continue paying the restaurant directly under its existing agreements; RestaurantOS records platform sales, fees, refunds and reported payout data and reconciles it against actual bank credits.
- Payment states must come from trusted provider/platform webhooks or APIs, not browser-side assertions.
- Subscription payments: online UPI, card and net banking. Restaurant subscription expiry preserves login and historical records while locking paid features and showing renewal reminders.

**Not production-enabled:** no live payment collection, marketplace split, automatic commission deduction, refund execution or bank payout is claimed as implemented. Do not collect customer funds into an ordinary company bank account and manually forward them. Complete provider approval, contracts, legal/tax review and end-to-end reconciliation before enabling real money.

## 6. POS, billing and accounts

- POS supports counter, takeaway, dine-in, table orders and walk-ins.
- Payment modes: cash, UPI, card, bank transfer, split payment, partial payment and customer credit/udhar.
- Customer khata: customer name, credit amount, date, jama payments and remaining balance.
- Counter invoice: GST/non-GST, discount, payment details, PDF; broader billing requirements include thermal print, WhatsApp share, refunds and bill history.
- Daily cashbook: cash, UPI, card and online payments, opening/closing cash, expenses, refunds, reconciliation and daily closing report.
- Only Owner closes the day. Closing includes payment reconciliation, opening/closing cash, sales, expenses, refunds, udhar, differences and Owner approval.
- Expenses: name, amount, date, category, payment mode and description. Only Owner enters expenses under the selected policy.
- GST: GSTIN, CGST/SGST/IGST, HSN/SAC, tax configuration, exportable reports and branch-wise settings.

## 7. Menu, purchases and inventory

- Menu management: manual entry, Excel bulk import, menu copy, bulk edit, duplicate and category management.
- Item details: photo, name, price, description, ingredients, allergens, nutrition, portion, customization, add-ons, availability and channel-specific details.
- Pricing may vary by size, add-ons, branch, platform and time.
- Availability supports manual control, stock-based control, breakfast/lunch/dinner schedules and Owner/Manager override.
- Recipe module, as selected: recipe name and ingredients only. Do not assume ingredient quantities or automatic recipe-based stock deduction.
- Purchase entry: item, quantity, rate, total, date, supplier and payment status.
- Stock: current stock, purchases, manual adjustments, low-stock alert and expiry alert.
- Supplier profile: name, mobile, address and purchase history.
- The selected scope does not yet include full supplier ledger, wastage valuation or automatic recipe/BOM consumption. These require a later explicit decision.

## 8. Staff and HR

- Employee profile: name, mobile, address, position and joining date.
- Attendance: Owner/Manager manually marks Present/Absent.
- One common shift for all employees in the initial scope.
- Owner records leave date and reason; no employee leave-request workflow in the initial scope.
- Employee management includes salary and leave records.
- Payroll scope selected earlier includes salary, attendance, paid/pending status, advances, deductions, overtime, salary slips, leave, bonus and reports. The final Q120 choice is Employee Profile + Attendance + Salary + Leave Records; detailed payroll subfeatures must be phased and permission-tested before launch.

## 9. Tables, reports and insights

- Table management: table status, customer/order details, table-wise billing and split bill. No reservations in the initial scope.
- Reports: sales, orders, payments, expenses, P&L, GST, customers, menu, inventory, employees, platform-wise, branch-wise and custom dates.
- Export/share: PDF, Excel, CSV, WhatsApp/email share and print.
- Owner profit view: revenue, expenses, food cost, commission and net profit separately, with daily/weekly/monthly views.
- Dashboard comparisons: charts, trends and performance indicators.
- Public-information market intelligence: competitor pricing, ratings, popular items and market insights; no private competitor data.
- Optional advisory AI suggestions only for sales/profit, menu, pricing, stock and customer marketing. AI is not an ERP command executor and must not silently edit business records.

## 10. SaaS / Super Admin

- Owner self-registration and Super Admin-assisted onboarding; Super Admin decides approval, verification, pending or rejection.
- Free and premium subscriptions; monthly/annual plans; Super Admin controls prices, features, limits, offers, trials, upgrades/downgrades and suspension.
- One Master Dashboard for businesses, branches, online/offline sales, orders, expenses, stock, staff and net profit; detailed module screens remain separate.
- Branch-level data separation with combined reports.
- Support: tickets, WhatsApp, email and live chat with tracking, priority, assignment, history and feedback.
- Notifications: in-app/web, email, WhatsApp and mobile push, with user preferences and consent.
- Super Admin company analytics: restaurants, users, orders, sales, commission, subscriptions, settlements, refunds, expenses, profit and growth.
- Super Admin oversight/support access is audited. No unapproved financial alteration.
- Only one Super Admin; initial account is provisioned privately, never through open public admin signup.

## 11. Security, privacy and reliability

- Supabase Auth email/password for restaurant/platform users; password reset by email. Customer checkout currently uses the selected no-SMS-OTP flow.
- PostgreSQL Row Level Security and strict tenant/branch scoping for every business table.
- Configurable staff permissions enforced in database policies/RPCs, not just hidden UI buttons.
- Audit trail records actor, time, action, entity and old/new values for sensitive changes.
- Data remains available while the account exists; closure retention follows legal requirements.
- Regular backups, manual backup, restore testing, disaster recovery and monitoring.
- Never ship service-role keys, database passwords or payment secrets to browser code.
- Complete DPDP/privacy, GST, FSSAI e-commerce FBO, payment-aggregator/RBI and contractual review with qualified professionals before production launch.

## 12. Current repository baseline (audited)

Repository: `gauravjoshi2999/restaurant-os`, default branch `main`. Frontend is currently a single responsive `index.html` owner workspace and a separate `customer.html` storefront, backed by Supabase Auth/PostgreSQL.

The README and setup guide describe an existing prototype foundation:
- Auth/session restoration, restaurant memberships and role foundation.
- Restaurant onboarding and Super Admin foundation.
- Order creation with multiple line items, order lifecycle and status history.
- Manual payout reconciliation fields and financial snapshot/settlement-draft foundations.
- Menu catalog and public restaurant/storefront/customer-order database foundations.
- Customer checkout SQL was revised to a no-OTP contact flow.

The repository explicitly states these are not yet complete production capabilities:
- Full customer checkout UI/payment collection and end-to-end production flow.
- Authorized live Zomato/Swiggy integrations.
- POS, complete accounting/reporting and the broader modules in this blueprint.
- Payment provider onboarding, split settlement, automated commission/refunds/payouts.
- Production security, tenant-isolation, backups, monitoring and complete role-by-role tests.

The existing Supabase project has already had its documented SQL phases applied and verified during development. **Do not rerun the initial schema or the existing migration chain on the live project merely to start the next phase.** Inspect the live schema and migration history first, then add small forward-only migrations.

## 13. Implementation roadmap and acceptance gates

### Phase 0 — Baseline and safety (first)
1. Capture current Git commit and deployment workflow state.
2. Inventory all frontend pages, event handlers, SQL migrations, RPCs, policies and storage/realtime configuration.
3. Compare repository migrations with the actual Supabase schema; verify current Owner, Manager, Staff, Super Admin and Customer access.
4. Create a test matrix and a safe test restaurant/account. Never test destructive changes against real business data.
5. Confirm GitHub Pages build and mobile/desktop baseline before edits.

**Gate:** current login, session restoration, restaurant selection, order create/status history, menu and customer storefront must be reproducible; no existing data is modified.

### Phase 1 — Stabilize the existing core
- Refactor the single-file frontend incrementally without changing existing behavior.
- Fix and test responsive navigation, session handling, role-based screens and loading/error states.
- Add consistent data access helpers and input validation.
- Verify order status transitions and customer ownership with RLS tests.

**Gate:** Owner/Manager/Staff/Super Admin/Customer test matrix passes; no cross-tenant reads/writes.

### Phase 2 — Complete the own-platform ordering journey
- Publish restaurant discovery/menu pages from real database data.
- Complete cart, checkout, customer profile/contact/address, order placement and customer order history.
- Add realtime order status and ETA; validate duplicate-submit and failed-network recovery.
- Keep real payment collection disabled until payment provider approval and legal structure are complete.

**Gate:** test order can be placed and tracked end-to-end in sandbox/test mode, with tenant and customer isolation verified.

### Phase 3 — Owner order operations and POS
- Unified order board, channel filters, manual order creation rules, offline POS and table billing.
- Payment-mode records, split/partial payments and customer credit/khata.
- Owner-controlled accept/reject/status workflow and cancellation approvals.

**Gate:** each channel and POS path produces correct immutable order/financial records; no KOT/KDS added.

### Phase 4 — Menu, purchase and stock
- Complete menu management, bulk import, branch availability and schedules.
- Purchase entry, supplier directory, current stock, manual adjustments, low-stock and expiry alerts.
- Recipe name/ingredient directory only unless scope is explicitly expanded.

**Gate:** quantities, totals, permissions and alerts pass test cases; no unsupported automatic recipe deduction.

### Phase 5 — Cashbook, billing, GST and reporting
- Invoices, payment reconciliation, daily cashbook and Owner-only day closing.
- Expenses, GST configuration, P&L, daily/monthly/custom reports and exports.
- Clearly distinguish platform-reported payout from verified bank credit.

**Gate:** sample transactions reconcile exactly across order, invoice, cashbook and report.

### Phase 6 — Staff, CRM and customer growth
- Employee profiles, attendance, salary/leave records and phased payroll.
- Customer CRM, reviews, offers, coupons, loyalty/referral and consent-aware campaigns.

**Gate:** role permissions, customer privacy, campaign opt-out and payroll calculations verified.

### Phase 7 — Super Admin SaaS and branches
- Multi-branch operations, subscription plans/billing, support and company analytics.
- Audited support access, backup/restore and monitoring.
- Market intelligence and optional advisory AI suggestions.

**Gate:** subscription lifecycle, branch isolation, admin audit and restore drill pass.

### Phase 8 — External integrations and production launch
- Apply for/secure authorized Zomato and Swiggy API/partner access; integrate only approved endpoints.
- Onboard an authorized payment aggregator/marketplace settlement provider; implement webhook verification, commission, refunds and settlement approvals.
- Complete legal, privacy, security, load, disaster recovery and real-device reviews.

**Gate:** provider certification/approval, legal sign-off, independent security review and full reconciliation tests. Until then, integrations and live payments remain clearly marked unavailable/manual.

## 14. Development rules

1. Work from this baseline; do not silently reinterpret selected answers.
2. Do not deploy untested code or claim an integration is live when it is not.
3. Make small, reviewable commits and forward-only database migrations.
4. Preserve current user data; use test accounts and reversible migrations.
5. Every phase must include its test results, known limitations and exact user action (if any).
6. Never ask the user to paste secrets, passwords or service-role keys into chat.
7. Hotel/room/guest/housekeeping features remain deferred until the Owner explicitly starts that phase.
