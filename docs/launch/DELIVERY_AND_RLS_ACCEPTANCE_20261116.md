# Bite — Delivery Security and Owner Tenant Isolation Acceptance
Date: 16 November 2026 (Asia/Kolkata)
GitHub: `gauravjoshi2999/restaurant-os`
Supabase: `wedbgpybbgsszcmffoha`

## Completed, separately verified

### 1. Delivery handoff UI (PR #137)
- PR: https://github.com/gauravjoshi2999/restaurant-os/pull/137
- GitHub Actions: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43799850296 — **success**; merged as `30a704f1f8db0b66aa21265c0d1eb61bb0fe992c`.
- Removed dead public "Demo Test" link, duplicated robots tag and confusing testing text from `delivery.html`.
- OTP remains the first primary card. When order is `Ready`, form is unavailable and button **Check handover status** allows a recheck without a full-page reload. After `Handed Over`, OTP input becomes visible.
- Executed `scripts/delivery_handoff_mobile_browser.py` in a 390px Chromium mobile viewport with intercepted/synthetic Supabase RPC responses. Verified Ready → Handed Over → incorrect OTP → correct OTP; a missing token gets a comprehensible error. No real delivery/order/payment/OTP touched.
- Test is **not** a physical Android APK test and does **not** certify GitHub Pages published the most recent build.

### 2. Deployed delivery RPC logic in isolated PostgreSQL 17 (PR #136)
- PR: https://github.com/gauravjoshi2999/restaurant-os/pull/136
- GitHub Actions: https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43799934379 — **success**, including dedicated job `delivery-handoff-postgres-qa`. Merged as `8435c6834d55954ad521639d3c38be888c2edc62`.
- `scripts/delivery_handoff_pg_fixture.sql` contains the four server-side functions copied directly from the currently deployed Supabase database (as inspected on 16 November 2026), plus minimal synthetic tables and roles.
- `scripts/delivery_handoff_pg_security_test.sql` tested:
  - Anonymous role lacks direct handoff-table reads and privileged Owner/Customer RPC EXECUTE.
  - Owner A denied generating Owner B's restaurant delivery link.
  - Valid Owner can mint a new 64-character secure token.
  - Owner cannot retrieve customer-only OTP.
  - Bearer invalid token denied; valid active bearer can read details by design.
  - OTP confirmation blocked until Owner has actually marked `Handed Over`.
  - Unrelated customer account cannot read the OTP; correct customer can.
  - **Five** invalid attempts increment counter; sixth is rejected.
  - Regeneration invalidates the previous bearer URL.
  - Correct OTP atomically completes the order once, stores one status event and deactivates link.
  - Expired token cannot reveal delivery data or confirm completion.
- These are PostgreSQL function-level integration checks on synthetic data, **not** real production transactions. Concurrent two-session race testing remains open.

### 3. Actual production tenant RLS read-only smoke
- Source: `docs/sql/owner_tenant_rls_readonly_20261116.sql`.
- Ran a transaction-scoped `authenticated` role/claim evaluation for the **5 existing owner memberships**, ending in explicit `ROLLBACK`.
- Verified each selected Owner could read its linked restaurant but **not** another restaurant's private restaurant row, membership, unrelated customer's orders, cashbook records or inventory balances through the currently deployed RLS rules.
- Execution completed without an error; the follow-up membership count was 5.
- This proves actual DB/RLS policy behavior under simulated JWT claims, **not** successful login on the Android Partner APK, nor all possible custom RPC access controls.
- No output contains real customer contact data or Owner IDs, and no persisted records were changed.

### 4. SECURITY DEFINER callable inventory and targeted checks
- Read-only inventory of **79** public SECURITY DEFINER functions: **5** executable by anonymous, **52** executable by authenticated. All inspected functions have an explicit `search_path` setting.
- Anonymous functions reviewed by purpose: `bite_storefront`, `confirm_delivery_handoff`, `get_delivery_handoff`, `is_restaurant_public`, `list_public_restaurants`. Storefront queries filter published, approved and active restaurants. Delivery bearer RPCs have token/expiry/OTP rules described above.
- Targeted body inspection of eight privileged authenticated financial/owner-mapping functions found explicit `is_platform_admin()` or restaurant-owner authorization gates: `admin_replace_owner_mapping`, `admin_resolve_owner_mapping`, `bite_admin_refund_decision`, `bite_admin_request_refund`, `record_actual_gateway_fee`, `record_order_payment_reconciliation`, `create_weekly_settlement_draft`, `bite_pause_coupon`.
- **This is not a full 79-function security audit** and does not prove no weakness exists. Notably, five public function grants and bearer URL exposure require continued monitoring; no grants were changed here.

## Still open, not to be marked as done
- Signed-in **physical Android** Partner, Super Admin, and delivery person E2E.
- Two real isolated accounts under actual Auth, direct network read/write negative tests across restaurants.
- Simultaneous delivery OTP race/duplicate clicks and provider/network interruption testing.
- Confirmation of live Pages deployment and actual WhatsApp handoff.
- Cashfree split, refund lifecycle and real payout/bank reconciliation.
- Hotel Maharani Palace's 21 missing historical dishes, 25 paused items, photo licensing/real load and unfilled restaurant address/coordinates.

**Security rule:** No production orders, customer profiles, payout accounts, menu prices, real OTPs, restaurant permissions, Cashfree payments or refunds were changed by the acceptance tests.
