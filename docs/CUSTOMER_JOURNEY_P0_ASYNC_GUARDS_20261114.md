# Bite — Customer Journey P0 Async Safety Addendum
Date: 2026-11-14
Branch: `fix/bite-customer-p0-async-guards-20261114`

## Existing scope
The earlier customer audit in `docs/CUSTOMER_JOURNEY_P0_AUDIT_20261114.md` already covers discovery PIN recovery, stale PIN search and truthful delivery service labels. This addendum covers additional verified code-level defects; it does **not** replace that document.

## Confirmed async P0s
| ID | Source evidence | Fix |
| --- | --- | --- |
| C-P0-04 | `openCheckout()` reads a restaurant menu asynchronously while using global mutable `activeRestaurant`, `menuItems`, `cart`. A late response for A could mutate B's cart/menu after a quick restaurant switch. | Checkout generation counter plus restaurant and cart signatures checked after Auth, menu and saved-details awaits, including stale error paths |
| C-P0-05 | A checkout profile/address response could complete after closing checkout, switching account or changing item quantities, causing wrong customer form values and stale availability. | Invalidate checkout sequence on restaurant open, checkout close and account switch. Late responses are ignored |
| C-P0-06 | Cart `Continue` handler had no synchronous in-flight gate before awaiting restaurant-hours validation. Double taps could start overlapping checkout attempts. | One in-flight Continue transition per tap cycle, released in `finally` on success, early return or error |
| C-P0-07 | `loadMyOrders()` awaited session and RPC without request identity checks, and the Auth logout handler did not clear `customerOrders` or old DOM cards. A delayed response could show a previous account's data after logout. | Per-request sequence/customer identity guard; invalidate requests and clear order array/detail and DOM on account transition |
| C-P0-08 | `loadOrderDetail()` could finish after account transition and write to a stale element. | Check request identity and target connectivity before applying responses or errors |

## Customer flow boundaries
- Preserved existing Supabase `list_my_customer_orders` RLS, restaurant scoped menu and `check_restaurant_delivery_area` validation.
- No change to Cashfree session creation, intent, payment verification, settlement, refund, order activation, coupons, cart price arithmetic or delivery OTP.
- Existing Owner, Admin and Super Admin files untouched.
- New Node delayed-promise tests explicitly reproduce the race order: A request begins, context changes, A resolves late, then must be discarded.
- Existing Chromium synthetic user journeys and ephemeral PostgreSQL tests should continue to pass.

## Acceptance, coverage and remaining limitations
- Release gate: source guard tests + new `scripts/customer_p0_async_races.test.cjs`, other Node suites, Chromium customer journey, PostgreSQL regression, then a successful GitHub Pages deployment for the merged SHA.
- Coverage is code-level/deterministic synthetic behavior; real signed-in Android/iOS interaction and provider-managed Cashfree processing remain unverified.
- Do not claim the broader premium customer redesign or real-money marketplace is fully complete based on this patch alone.
