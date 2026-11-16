# Bite Role Separation — Navigation and RLS Audit
Date: 16 November 2026 (Asia/Kolkata)

## Observed source code
`index.html` `applyRoleUI()` and `showPage()` independently define and enforce the same role-scoped route sets:

- **Restaurant Owner — 13:** `overview`, `orders`, `pos`, `menu`, `tables`, `khata`, `cashbook`, `expenses`, `purchases`, `inventory`, `hr`, `reports`, `settings`.
- **Super Admin — 10:** `overview`, `restaurants`, `orders`, `reconciliation`, `financials`, `audit`, `support`, `moderation`, `customers`, `storefront`.
- The app-shell route query `bite_app=admin` rejects non-`super_admin` and `bite_app=partner` rejects non-`owner` UI entry. `showPage()` rejects a destination missing from the role allowlist.
- A new regression suite `scripts/role_route_matrix_regression.test.cjs` was added via [PR #132](https://github.com/gauravjoshi2999/restaurant-os/pull/132); its test/merge status must be checked separately.

## Production RLS / role mapping
Read-only inspection of Supabase `wedbgpybbgsszcmffoha`:
- 5 restaurant membership rows, each belonging to a distinct user and restaurant; no multi-restaurant membership conflicts and no restaurant with multiple Owner accounts at inspection.
- Hotel Maharani Palace has exactly one Owner membership.
- No Platform Admin user was also present as a restaurant member in the observed rows.
- `restaurants`, `restaurant_members`, `menu_items`, `orders`, `order_items`, delivery zones and zone PIN mappings have RLS enabled with scoped policies.
- Restaurant menu mutation policy requires restaurant Owner/Manager. Menu public-read policy limits available items to public restaurants. Customer order read policy filters by authenticated customer, and restaurant members read only their own restaurant orders.
- Server-side approval field guard disallows non-Admin changes to onboarding status, approval metadata, publication status and Active state. Commission guard limits `platform_commission_rate` updates to Platform Admin.
- The source code and RLS policies are defense-in-depth. **UI hiding is not authorization**, and this is **not** a fresh authenticated two-user negative-permission test.

## Remaining independent acceptance
1. Use two *authorized isolated test identities* (Owner A, Owner B), verify restaurant A cannot load/update B's private data via both UI and direct PostgREST calls. Do not access any unrelated real account.
2. Verify Owner is denied publication, commission and membership changes with a rollback-only test, and Admin can use permitted actions.
3. Verify Android Partner and Super Admin APKs enforce app scope after login/session restoration (not only browser tabs).
4. Confirm support and refund view scopes with private customer information kept restricted.

No user accounts, memberships, protected settings, orders, balances or payments were modified.
