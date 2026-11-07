# Bite Owner Dashboard Audit & Verification — 2026-11-07

## Scope and test approach
Reviewed the current main-branch owner/admin workspace (`index.html`), customer app and approved `docs/PRODUCT_BLUEPRINT.md`; checked live Supabase RLS-visible counts under simulated authenticated Owner and Super Admin contexts using rollback-only SQL transactions; inspected Supabase security advisors; and checked GitHub Pages workflow results. No production business rows were changed by the rollback-only tests.

This is a focused smoke/security review, **not a complete browser E2E certification**. Separate Manager and Staff test identities are not currently represented in the live membership sample, and the repository workflow currently performs inline JavaScript syntax validation only.

## Verified checks
- GitHub Pages workflow's Node `--check` step passed on the reviewed change commits.
- RLS Owner scope smoke tests returned tenant-scoped results: a demo Owner with one restaurant membership saw 1 restaurant / 0 orders / 1 membership; another Owner saw 1 restaurant / 9 orders / 1 membership.
- A multi-restaurant owner identity saw only its 2 restaurant memberships and associated workspace-scoped data (2 restaurants / 1 order / 40 menu rows / 3 memberships in the sample). The UI's tenant dropdown existed but its change handler was missing; this is now wired to change the selected restaurant and refresh the active workspace.
- Super Admin scope smoke test returned platform-wide sample visibility (10 restaurants / 18 orders / 7 memberships), as expected for platform administration.
- Owner and Super Admin contexts were tested using `SET LOCAL ROLE authenticated` and `request.jwt.claim.sub`; test statements ran inside transactions followed by `ROLLBACK`.
- Owner login had been routed straight to All Orders instead of the Overview home screen. Login routing is now changed to Overview for Owner/Manager; Staff remains routed to Orders.
- Dashboard greeting text is now populated rather than left as placeholder.

## Findings / release blockers (do not treat as production-ready)
1. **Live payments are not implemented.** Customer checkout is not connected to an authorized payment aggregator, trusted provider webhooks, commission deduction/split settlement, bank payout, or actual refund execution. Do not accept real marketplace funds until legal/provider approval and payment lifecycle reconciliation are implemented.
2. **Zomato/Swiggy are not live API integrations.** External order input is a manual/demo path until partner approvals and API integration exist.
3. **Manager/Staff authorization has not been end-to-end verified against dedicated accounts.** Existing UI role hiding is not sufficient by itself; database RPC and RLS denial tests are required for each role and each sensitive operation.
4. **Dashboard/business reports need reconciliation validation.** Current sample is small and has no live expense or settlement records (live tables returned 0 expenses and 0 settlements). Reports should not be relied upon as audited P&L until tests with known ledger inputs reconcile totals, date boundaries, discounts, refunds, payment channels and tax.
5. **Delivery handoff, cancellation, reviews, refund, settlement and customer complaint workflows need full browser-path tests.** Backend schema/RPC and JavaScript syntax checks are not proof of the full UX working end to end.
6. **Supabase security advisor still reports findings.** One table (`restaurant_delivery_handoffs`) has RLS enabled with no direct policies; confirm this is intentionally accessed only via narrow RPCs. Advisor also reports callable SECURITY DEFINER RPCs; each should have authorization/input checks reviewed before production.
7. **No automated UI test suite** (browser test runner, role fixtures, E2E tests) is configured. Current GitHub Actions workflow only syntax-checks inline scripts then deploys static pages.

## Fixes in this audit pass
- Wired `#tenantSwitcher` change events to `switchRestaurant()`.
- On tenant change, refreshes the current page's data loader so dropdowns and rows are rebuilt against the selected restaurant.
- Routes Owner/Manager login to Overview (Owner home) instead of directly into Orders.
- Populates the Owner dashboard greeting/subtitle.

## Acceptance test plan required before production
- [ ] Owner account A: verify orders, menu, sales, expenses, purchases, inventory, staff, cashbook, reports, settlement, delivery zones all only show A's selected restaurant.
- [ ] Multi-restaurant Owner: switch A ↔ B on each workspace and confirm selection and all totals/rows refresh, no stale data persists.
- [ ] Owner A directly calls RPC/table APIs with restaurant B IDs: every unauthorized read/write denied.
- [ ] Manager: only Owner-granted permissions; prove expense entry, cash closing, settlement and privileged settings denied where not granted.
- [ ] Staff: restricted menu, order channel, status, expense, stock, HR and report actions tested via direct RPC as well as UI.
- [ ] Customer and delivery partner: create paid order only with provider-confirmed payment; verify accepted → preparing → ready → handoff link → OTP complete, cancellation/complaint/review and customer-only order visibility.
- [ ] Known-number reconciliation test for daily sales, POS split payments, cashbook, expenses, refunds, platform commissions, customer khata and datewise reports.
- [ ] Mobile Android Chrome and desktop browser walkthrough across every Owner screen.
- [ ] Resolve or formally accept Supabase advisor findings, configure Auth leaked-password protection, backups and monitoring.
