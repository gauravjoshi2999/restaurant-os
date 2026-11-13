# Bite Owner — Mobile-first roadmap and delivery log

**Date:** 13 November 2026  
**Scope:** Restaurant Owner panel first; retain Bite's customer ordering, online order lifecycle and platform admin as separate roles.  
**Principle:** One change at a time; preserve existing records and permissions. Do not call a feature complete until its browser and tenant-isolation tests pass.

## What exists in this repository (code-level observations, not production certification)

- Owner workspace routes: Overview, Orders, POS & Billing, Menu, Tables, Khata, Cashbook, Expenses, Purchases & Suppliers, Inventory, Employees & HR, Reports, Settings.
- POS bill entry is enabled in the current `index.html`; Home's **New POS Bill** opens the bill dialog, while the POS section contains saved drafts and POS history. WhatsApp bill sharing is optional and requires customer consent.
- Owner/Customer/Admin roles are separated, with tenant-scoped Supabase queries and RLS foundations. These controls still require adversarial end-to-end validation.
- Existing docs that describe POS as disabled are outdated relative to the current code and must be reconciled before release.
- Marketplace payment/settlement/refund and offline resilience must not be represented as production-ready without provider and security verification.

## Owner's actual daily workflow

1. **Morning:** Open Home, see pending online orders, cash opening, any overdue supplier/customer balances, and today's staff.
2. **Each walk-in:** Tap **New Bill**, choose items, quantities, discount/tax where configured, payment method and amount received; save/print; WhatsApp only with consent. Resume interrupted draft safely.
3. **Throughout day:** Record milk quantity and price against supplier; purchases, wastage and other expenses; staff attendance and salary advances; customer credit/collections.
4. **Evening:** Reconcile cash, UPI and online collections separately; check unpaid POS dues and supplier balances; complete day closing with a discrepancy note.
5. **Month end:** See sales by channel, operating expenses, supplier dues, staff payables/advances, estimated margin, and exportable reports. Estimates must be labeled; do not mix demo data with real totals.

## Sequence (each phase requires review and approval before the next)

| Phase | Work | Done when |
|---|---|---|
| **P0-1** | Owner mobile navigation: Home, Orders, New Bill, Kharcha, More; contextual top Back; existing full drawer for remaining tools | 320–430px touch targets, correct page/back/More behavior, Admin isolated, POS shortcut opens in one tap, no overlapping bottom controls |
| **P0-2** | Billing reliability audit and cleanup | Cash/UPI/split/partial payment and credit recorded correctly, duplicate-submit prevented, draft recovery and invoice/WhatsApp consent tested, online sales not double-counted |
| **P0-3** | Daily owner dashboard and closing | Today's real POS + online sales shown as distinct channels, expenses and dues correct; closing reconciles cash/UPI with auditable adjustments |
| **P1-1** | Milk/supplier daily ledger | Supplier, date, liters, rate, amount, paid, due and corrections; duplicate entry safeguards; monthly supplier statement |
| **P1-2** | Staff attendance, salary, advance ledger | Shift/attendance, configurable salary basis, advances and net payable with owner confirmation and audit trail |
| **P1-3** | Expense + purchase integration | Expense categories, receipt image, supplier purchase vs cash outflow separation, no double-counting |
| **P1-4** | Monthly owner reports | Sales by channel, gross vs net collections, expenses, staff payables, supplier dues, exports and reconciliation |
| **P2** | Advanced stock/recipes, CRM/loyalty, printing/offline queue, operational automation | Only after core financial and tenant-isolation flows are stable and measured |
| **Cross-cutting** | Reliability, accessibility, backup/export, permissions, monitoring, incident support | Each phase has mobile QA, RLS negative tests, real/dummy data separation, migration rollback and user acceptance |

## P0-1 implementation boundary

The first PR adds a mobile Owner navigation shell only. It **does not** change database schema, online order/payment behavior, POS totals, user roles or customer UI. The central **New Bill** action reuses the existing `openPosFromOverview` flow. **More** opens the existing full navigation drawer; Logout moves into the drawer on narrow screens. Back returns to the previous Owner section, falling back to Overview. Desktop and Platform Admin navigation remain unchanged.

### Acceptance checklist

- [ ] Automated Node tests and existing CI pass.
- [ ] Real Chromium Owner layout smoke test at 320, 390 and 430 CSS pixels.
- [ ] Manually verify on a physical Android device (browser and installed Owner app).
- [ ] Verify keyboard/screen-reader labels, safe-area bottom inset and no horizontal overflow.
- [ ] Verify a POS modal and its Save/Cancel controls are not covered by the fixed bar.
- [ ] Verify returning from Reports, Staff and Purchases via Back and More.
- [ ] Verify Owner role only; Admin/unauthenticated users see no Owner tabs.
- [ ] Review PR, then merge/deploy; never assume a PR is live.

## Competitive research questions (to integrate with the ongoing deep research)

Benchmark **Zoho Books/Inventory/POS, Vyapar, Petpooja, Restroworks/Posist, UrbanPiper** using current official docs and user reviews. Verify: mobile billing speed, invoice delivery, KOT/table workflow, offline sync, milk/recurring supplier ledger, payroll/advances, month-end closing, exports, GST settings, customer consent, audit logs, pricing/support and backup. Distinguish a general accounting tool from a restaurant POS. Add dated citations and a feature-gap table before selecting P0-2 scope.

## Release discipline

No demo transactions in owner financials; no automatic real payments, refunds or WhatsApp sends; no destructive migration. Use feature branches/PRs, test data and staged release with rollback. Treat GitHub Pages build success as deployment evidence, **not** proof of correct financial calculations or secure Supabase permissions.
