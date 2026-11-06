# RestaurantOS — Phase 0 Repository Audit

**Audit date:** 2026-11-06  
**Scope:** Repository and migration-file inspection only. No live Supabase schema or customer data was queried.

## Repository facts verified

- Repository: `gauravjoshi2999/restaurant-os`
- Default branch: `main`; linked GitHub permissions include push/admin.
- Deployment: GitHub Pages workflow runs on pushes to `main` and uploads the repository root as a static site.
- Frontend: two large standalone pages, `index.html` (owner/admin workspace) and `customer.html` (customer storefront), using Supabase JS v2 from a CDN.
- Backend: Supabase Auth + PostgreSQL, with SQL migrations in `supabase/`.
- No `package.json` or automated frontend test/lint suite was found at the expected root path. GitHub Pages workflow is a static deployment workflow, not a test/build pipeline.

## Existing foundations found in source

- Email/password authentication and session restoration in the owner workspace.
- Platform Super Admin check and restaurant membership roles.
- Restaurant onboarding, restaurant/order lists and multi-item order creation.
- Server-side order status transition enforcement and order status history.
- Menu categories/items and public published-menu read policies.
- Customer email/password login, customer contact profile, addresses, checkout RPC, order history and Realtime order-status foundations.
- Financial snapshot, reconciliation and weekly settlement-draft foundations.
- Existing documentation explicitly says live payments, marketplace settlement, automated refunds, live Zomato/Swiggy APIs, full POS and production security/monitoring are not complete.

## Important gaps and safeguards

1. **External platform manual entry:** the order form exposed Zomato/Swiggy demo channels to users who could create orders, while the order RPC checked restaurant membership rather than the Owner-only external-entry rule. The UI now hides those channel options from non-Owners, and a forward-only database migration has been added to enforce the rule server-side.
2. **Order status control:** the UI previously allowed Managers to advance order status, while the approved workflow says the Owner controls status updates. The UI now restricts status controls to Owner/Super Admin, and the same forward-only database migration adds a server-side guard.
3. **Migration not yet applied:** `supabase/phase4_external_channel_owner_guard.sql` is committed but has **not** been run against the live Supabase project. Apply it only after confirming the existing migration baseline; do not rerun the original schema chain.
4. **Role permissions:** the current UI uses broad hard-coded role visibility, not the full per-employee configurable permission matrix. Hiding a button is not security; granular permissions need database/RPC enforcement in a later phase.
5. **Payments:** customer checkout currently creates an order and a pending financial snapshot. It does not collect money. No real payment provider, split settlement, refund execution or bank payout is connected.
6. **External APIs:** Zomato/Swiggy choices are labelled demo/manual; there is no verified live API connection. Partner access and approved API credentials are prerequisites.
7. **Deployment status:** a push to `main` triggers the Pages workflow, but the workflow run result and live-browser behavior were not available in this repository audit. Do not treat a commit as proof that the live website has deployed successfully.
8. **Live database status:** repository SQL and setup documentation were inspected. The current Supabase schema, migration history, RLS behavior and actual production data were not queried in this audit.

## Changes made during Phase 0

- Added `docs/PRODUCT_BLUEPRINT.md` as the approved 120-answer product baseline and phased delivery roadmap.
- Updated `index.html` so only Owner/Super Admin can select manual Zomato/Swiggy channels and advance order statuses.
- Added `supabase/phase4_external_channel_owner_guard.sql` to enforce those two rules in PostgreSQL, including a server-role path for a future approved backend connector.
- Updated `SUPABASE_SETUP.md` with the new migration order.

## Phase 0 acceptance checklist

- [x] Confirm repository identity, default branch and push permission.
- [x] Inspect current owner and customer entry pages.
- [x] Inspect the documented SQL migration sequence and major RPC/policy foundations.
- [x] Record product requirements and implementation roadmap.
- [x] Add UI-level safeguards for Owner-only external manual entry and order status changes.
- [x] Add forward-only database guard migration.
- [ ] Run the new migration in a safe/test Supabase environment.
- [ ] Verify Owner, Manager and Staff restrictions against the database (including direct RPC/API attempts).
- [ ] Confirm GitHub Pages deployment run and test the deployed pages on Android and desktop.
- [ ] Inspect actual live Supabase schema/migration history and run tenant-isolation tests.

**Phase 0 is partially complete.** The repository baseline and first permission correction are committed. Database application, live deployment verification and real-device testing remain outstanding.


## Live Supabase verification update — 2026-11-06

The live Supabase project `wedbgpybbgsszcmffoha` was subsequently inspected through the connected Supabase integration. This section supersedes the earlier repository-only scope statement above.

- Project status: ACTIVE_HEALTHY; PostgreSQL 17.
- RLS is enabled on all inspected public application tables.
- Live data counts at verification: 10 orders, 11 order items, 42 order-status history rows; these counts were unchanged by the hardening work.
- The two order guard triggers are present on `public.orders`.
- The live guard functions were verified to check restaurant Owner membership for external-channel entry and status changes; they do not rely on a Super Admin bypass.
- Phase 5 migration applied successfully: ten missing foreign-key indexes added; profile own-row policies and order insert policy use initplan form for `auth.uid()`.
- Post-migration verification confirmed all ten indexes, three optimized profile policies, both order guard triggers and unchanged order counts.
- Security advisor still reports callable SECURITY DEFINER functions. These were reviewed as purpose-built RPCs/helpers: customer checkout is intentionally callable by customers, public restaurant listing returns only published restaurant fields, customer order history is scoped to `auth.uid()`, settlement draft and payment reconciliation require Super Admin, and permission helpers support RLS. Their EXECUTE grants were not blindly revoked because doing so could break RLS and required application workflows.
- Supabase Auth leaked-password protection remains disabled. The connected database tool does not expose the Auth dashboard setting; this remains a dashboard-level configuration task.
- Performance advisor no longer reports unindexed foreign keys or auth initplan warnings. It still reports overlapping permissive policies (intentional combinations of customer/team/platform-admin access) and unused indexes. Unused indexes were not dropped because current data volume is small and future query paths are expected.
- Supabase health advisor returned no findings.
- No customer/business rows were deleted or modified during the audit.


- Tenant-isolation smoke test: an authenticated user with Owner membership in one restaurant saw exactly 1 restaurant, 1 order and 1 membership in RLS-scoped queries; cross-restaurant rows were not visible. The second test identity is also the configured Super Admin, so its global visibility is expected and was not treated as a tenant-isolation failure.
- Current live sample has only Owner memberships (no Manager or Staff memberships yet), so Manager/Staff denial behavior still needs dedicated test accounts before production role rollout.

## Remaining release gates

- Verify GitHub Pages deployment run for the latest commit and perform actual browser/device smoke tests.
- Configure leaked-password protection in Supabase Auth dashboard when the setting can be accessed.
- Add automated tenant-isolation and role-based integration tests (Owner, Manager, Staff, Customer, Super Admin) before enabling more financial or staff-management operations.
- Obtain a proper database export/backup before any future destructive schema or data changes. No downloadable backup was created as part of this phase.


## Expense ledger module — 2026-11-06

- Added live table `public.restaurant_expenses` with restaurant scoping, date, category, title, amount, payment mode, note, creator and timestamps.
- Enabled RLS and verified it is active. Four policies: Owner/Manager read, Owner insert/update/delete. Super Admin read-only policy is included for platform oversight.
- Verified indexes for restaurant/date and creator lookup.
- A rollback-only authenticated Owner insert test succeeded; the test transaction was rolled back and no sample expense remains.
- A rollback-only attempt by the platform-admin account against a restaurant where that account is not an Owner was correctly rejected by RLS.
- Added an Expenses page to the owner workspace: restaurant selection, expense entry, edit/delete for Owner, read-only view for Manager, total and count.
- Frontend JavaScript syntax was checked after the change. GitHub Pages deployment for the latest commits is still pending; do not treat the new screen as live until the Actions run succeeds.
- The connected GitHub file-write action rejected creation of a separate SQL migration file. The live migration was applied successfully; repository migration-file synchronization remains an outstanding documentation/deployment task.


## Purchase and supplier module — 2026-11-06

- Live migrations applied: `20261106155407_restaurant_purchase_supplier_module`, `20261106155453_restaurant_purchase_supplier_fk_indexes`, and `20261106155547_restaurant_purchase_relationship_guards`.
- Added `restaurant_suppliers`, `restaurant_purchases`, and `restaurant_purchase_items`; RLS is enabled on all three.
- Owner/Manager can read and create supplier and purchase records. Existing purchase edits/deletes and supplier deletes are Owner-only in the current UI. Platform Admin oversight remains available.
- Purchase item line totals are generated by PostgreSQL. Stock is not automatically incremented; inventory linkage is a later phase.
- Added immutable tenant/creator guards and same-restaurant supplier validation.
- Rollback-only Owner test created a supplier, purchase and item; generated line total was ₹100.00. Transaction rolled back with no test data left.
- Added mobile-responsive Purchases & Suppliers UI and passed JavaScript syntax validation. Deployment and real-device smoke test remain pending.
- Purchase migration SQL is tracked under `supabase/`. The Expenses migration is live but its standalone SQL file is still not tracked.


## Inventory and stock ledger — 2026-11-06

- Live Supabase migrations applied: `20261106155919_restaurant_inventory_stock_ledger`, `20261106155927_restaurant_stock_movement_concurrency_guard`, `20261106155949_restaurant_inventory_fk_indexes`, and `20261106160036_restaurant_inventory_balance_view`.
- Added `restaurant_inventory_items` and immutable `restaurant_stock_movements`, both with RLS. Owner/Manager can add inventory items and stock movements; only Owner can delete an item. Movement history has no client update/delete policy.
- Stock-in types are Opening, Purchase, and Adjustment In. Stock-out types are Adjustment Out and Wastage. PostgreSQL rejects negative balances and locks the inventory item row to serialize concurrent movements.
- Added `restaurant_inventory_balances` as a `security_invoker` view, so the balance calculation respects base-table RLS. Owner test verified 10 kg opening less 3 kg out = 7 kg; an 8 kg further outflow was rejected. Transaction rolled back and no test rows remain. An outsider identity saw zero rows in a rollback-only tenant-scope test.
- Added Inventory & Stock page: item master, low-stock threshold, stock movement entry, current balances, low-stock count and latest 100 movement records. Balance totals use the database view across the full ledger, not just the 100-row history window.
- Purchase records do not yet auto-create stock movements; stock-in is currently recorded manually to avoid incorrect item/unit matching. This integration remains a follow-up.
- Added `supabase/restaurant_inventory_stock_ledger_reference.sql` as a consolidated schema reference. Live migration history remains authoritative.
- GitHub Pages run `42248397819` succeeded and published the Expense, Purchase/Supplier and Inventory UI code. A real Android/desktop browser smoke test has not yet been performed; the direct site was not accessible to the automated page viewer.


## Purchase → Inventory automatic stock posting — 2026-11-06

- Fixed two tenant-correlated RLS expressions on purchase-item and stock-movement inserts. Earlier policy text compared the inner table's restaurant ID to itself; policies now explicitly compare the referenced purchase/inventory row to the outer row's `restaurant_id`.
- Tightened existing purchase and purchase-item UPDATE policies to Owner-only (plus platform admin oversight), matching the UI and role model. Managers can create purchases and stock entries, but cannot alter existing purchase records.
- Added `inventory_item_id` to purchase items and `purchase_item_id` to stock movements. A purchase line mapped to an active inventory item with the exact same unit now automatically creates one immutable `purchase` stock movement in the same database transaction.
- Added guards: purchase and inventory item must belong to the same restaurant; unit must match; posted purchase item identity/quantity/unit/cost cannot be changed; linked purchase header supplier/date/invoice/total cannot be changed and the purchase cannot be deleted. Payment amount/mode and notes remain editable through the Owner workflow.
- Added `save_restaurant_purchase` RPC as SECURITY INVOKER, callable by authenticated users only. It atomically creates/updates purchase header and lines; it prevents stock from being duplicated on edits. `anon` EXECUTE is false, `authenticated` EXECUTE is true, and `prosecdef=false` verified.
- Frontend now offers an optional “Map to inventory” selector on each purchase line. Choosing an inventory item automatically fills its unit. Saving the purchase posts stock automatically; purchase history shows how many lines were stock-linked. Unmapped items remain purchase-only.
- Rollback-only Owner tests verified: mapped purchase added exactly 3 kg; payment-only edit did not duplicate stock; changing linked quantity was rejected; deleting linked purchase was rejected; unlinked purchase edits worked; unit mismatch was rejected. Cross-tenant purchase-item and stock-movement inserts were rejected. All tests rolled back; live purchase, purchase-item and stock-movement row counts remain zero.
- `supabase/patch_20261106_purchase_inventory_auto_stock_link.sql` tracks the live SQL patch. This is a reference patch file; the Supabase SQL execution is the live source of truth and is not represented as a new Supabase migration-history entry.
- JavaScript syntax validation passed. Latest UI commit is `28978a2488b1739f0b9566aad1682814e01c232a`; deployment still needs confirmation.


## Daily cashbook and owner day closing — 2026-11-06

- Added `restaurant_cashbook_manual_entries` (Owner-entered income/outflow), `restaurant_cashbook_closings` (one immutable close per restaurant/date), and `restaurant_cashbook_entries` SECURITY INVOKER view.
- Cashbook view combines Expense ledger outflows, paid Purchase outflows, and manual income/outflow. It separates Cash, UPI, Card, Bank Transfer and Other. It intentionally does not count online orders as cash received until a trusted actual-payment/settlement record exists; POS receipts will connect with the POS payment phase.
- Owner can add manual cashbook entries and close a day. Manager can view entries and closing summaries but cannot create manual entries or close the day. The close calculation is recomputed by a database trigger: opening cash + cash income − cash outflow = expected cash; counted cash difference is stored.
- Closing locks manual entries and prevents expense/purchase insert, update or delete for that closed date. Closing records have no update/delete policy. One close per restaurant/date is enforced.
- Rollback-only Owner test verified: ₹200 cash income, ₹100 expense and ₹50 purchase payment produced ₹200 cash in / ₹150 cash out; with ₹1,000 opening and ₹1,040 counted cash, expected cash was ₹1,050 and difference −₹10. Manual, expense and purchase changes after close were rejected. Test rows and closing were rolled back; no test data remains.
- Added `supabase/patch_20261106_daily_cashbook_owner_closing.sql` as a reference patch; live SQL execution remains authoritative. Cashbook UI is in `index.html`; JavaScript syntax validation passed. Deployment is pending latest GitHub Pages workflow.


## POS orders and actual payment ledger — 2026-11-06

- Added `restaurant_order_payments` with immutable Cash/UPI/Card/Bank Transfer/Other receipts, payment date, reference and notes. Owner/Manager/Staff can record payments for their own restaurant; only team members can read them. No update/delete policy is provided, so payment history cannot be silently rewritten.
- Added `restaurant_order_payment_summaries` SECURITY INVOKER view for paid amount, due balance and paid/partial/unpaid status. Partial and split payments are multiple rows against one order. Database locks the order row and rejects overpayment, cross-restaurant links, non-team writes and payment dates already closed in Cashbook.
- Added `create_pos_order_with_payment` SECURITY INVOKER RPC. It creates the POS order and its first payment atomically. POS channels are Counter, Takeaway and Dine-in; POS commission is 0%. Existing Own Platform commission remains 18%, and Zomato/Swiggy demo channels remain 0%.
- Manual payment recording is deliberately restricted to POS orders. Own-platform online payments and Zomato/Swiggy settlements must come from verified provider/settlement records, not a manual POS payment entry.
- Cashbook view now includes actual POS receipts as income. Daily closing therefore includes POS cash receipts; UPI/Card/Bank Transfer remain visible in their respective payment-mode totals.
- Added POS page with restaurant filter, order/sales/collected/due summaries, sale type selection, payment entry at sale time, order-level payment modal for later partial/split payments, and payment history. Order board shows POS paid/due status. Manager/Staff can record POS receipts; only Owner controls order status as before.
- Rollback-only tests verified: a ₹100 POS order with ₹30 Cash + ₹20 UPI showed ₹50 paid / ₹50 due; overpayment was rejected; cashbook received the POS cash payment; a closed day rejected further receipts; Own Platform manual payment was rejected; outsider tenant could not read or insert payments. Atomic POS overpayment test left no order/payment rows. All test transactions rolled back.
- Updated `create_order_financial_snapshot` only to recognize POS channels with 0% commission, preserving existing authorization, discount and financial-snapshot checks. The function remains SECURITY DEFINER as in the pre-existing architecture; its broader review remains a separate security task.
- Added `supabase/patch_20261106_pos_order_payments.sql` as the SQL reference patch. JavaScript syntax validation passed. Latest POS UI commit is `53e38dab8de0e1a5959bb268b4401e0ae9fdf21d`; deployment confirmation pending.
- Udhar/customer khata, refunds, online payment webhooks and provider settlements are not yet implemented. Unpaid POS balances are displayed as due, not falsely counted as received cash.


## POS permissions hardening — 2026-11-06

- Restricted manual order-payment recording at the database trigger to POS channels only. Own Platform and Zomato/Swiggy demo orders cannot be marked paid through the POS payment table; they require their own trusted payment/settlement source.
- Revoked UPDATE/DELETE privileges on POS payment rows, stock movement history and cashbook closing rows. These ledgers are append-only/immutable; corrections require future reversal/adjustment records.
- POS form now preserves the selected restaurant from the POS filter and uses full timestamp order codes to reduce collisions. Latest UI change commit: `f9bef54a137130db4f8cc5ba917584706cab6178`.


## Staff & HR module — 2026-11-06

- Added `restaurant_employees`, `restaurant_employee_attendance`, `restaurant_employee_leaves`, and append-only `restaurant_employee_payments`, all with RLS enabled and restaurant/employee tenant checks.
- Owner/Manager can manage employee profiles, attendance and leave records. New leave records are forced to Pending; approval/rejection records the acting user and timestamp. Employee payment records are Owner-only, immutable, and cannot be backdated into a cashbook day already closed.
- Salary, Advance and Bonus payments automatically appear as cashbook outflows. Deduction records are retained for payroll tracking but are not treated as money paid out. Cashbook day close therefore includes real employee cash payments.
- Staff & HR page includes employee profile create/edit, active/inactive status, date-wise attendance, leave records and approve/reject controls, Owner-only salary/advance/bonus/deduction entry, and payment history. Summary cards show active staff, present/half-day count, pending leave and recorded payments for selected salary month.
- Payroll calculation, overtime calculation, payslip PDF and employee self-service login mapping are not yet implemented; salary amount/period are stored but no automatic payable amount is claimed.
- Rollback-only Owner tests verified employee create, attendance update, leave approval audit, ₹500 salary cash payment in Cashbook, and cashbook day-close calculation. Closed-day employee payment was rejected. An outsider saw zero employee rows and could not write attendance/payments. Test data rolled back; no test rows remain.
- `supabase/patch_20261106_staff_hr_module.sql` tracks the live SQL patch. JavaScript syntax validation passed. HR UI deployment is pending the latest GitHub Pages workflow.


- HR UI follow-up commit `0396534b4e9dbdad9343332fcaf3c93ae5c6dd38` lets Owners record final payments for inactive employees; attendance and leave pickers remain active-employee-only.


## Customer Khata ledger — 2026-11-06

- Added `restaurant_customers` with restaurant-scoped customer profiles and normalized phone uniqueness (Indian +91/leading-zero formatting normalizes to the same 10-digit number).
- Added append-only `restaurant_customer_ledger_entries`: Debit = Udhar/amount customer owes; Credit = Jama/payment received. Balance view shows due when positive and advance when negative. Payment methods are required for credit receipts; credit receipts automatically appear as Cashbook income.
- Owner/Manager/Staff can view customer accounts and add ledger entries for their restaurant. Owner/Manager can update customer profiles; only Owner can delete. Ledger entries cannot be updated/deleted and are locked for a date already closed in Cashbook.
- Customer Khata page includes customer creation, mobile number, account list, total due/advance, debit/credit entry form and customer-wise ledger with running balance.
- Rollback-only test verified ₹1,000 debit less ₹300 Cash jama = ₹700 due; ₹300 jama appeared in Cashbook and day closing. Closed-day ledger entry was rejected. +91 formatted phone duplicate was rejected. Outsider saw zero customer balances and could not write ledger entries. All test rows rolled back.
- POS orders are not yet automatically linked to Khata customers. POS order due is still shown on the order/POS screen; manual Khata debit entry is available until that integration is completed.
- `supabase/patch_20261106_customer_khata.sql` tracks the SQL reference patch. JavaScript syntax validation passed. Deployment remains pending the latest GitHub Pages workflow.
