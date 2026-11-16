# Bite Launch — Restaurant Operations and Role-Safety Audit
Date: 16 November 2026 (Asia/Kolkata)
Restaurant ID: `262aaba7-f48b-4fa5-9ff6-b334ededca84`
**Read-only inspection**: no Supabase records were modified.

## Restaurant operating facts directly read from production
- Hotel Maharani Palace is `Active`, onboarding `approved`, `is_published=true`.
- `accepts_delivery=true`, `accepts_pickup=true`, `delivery_paused=false`.
- `opening_time=10:00`, `closing_time=23:00`, estimated preparation **30 minutes**.
- One active delivery zone named **Rajsamand**, and one recorded service PIN **313324**.
- Zone minimum order and default minimum order are both **₹1.00**; delivery fees are **₹0.00**. **Values unconfirmed commercially**, must not be replaced by guesses.
- Restaurant address **NULL**, latitude **NULL**, longitude **NULL**. Verify actual address/pickup map before launch; do not invent a location.
- Publicly published database flag does not, alone, prove Cashfree split/refunds, security acceptance or commercial launch readiness.

## Owner membership and approval / tenant security
- Exactly **1** `restaurant_members` row with role `owner` for this hotel.
- Platform-wide: **5** member rows for **5** restaurants, **5** unique user IDs. No users are linked to multiple restaurants; no restaurant has multiple owner memberships at inspection. Zero overlapping Platform Admin/restaurant membership rows. These findings may change with onboarding.
- `restaurants`, `restaurant_members`, `menu_items`, `orders`, `order_items`, `restaurant_delivery_zones`, and `restaurant_delivery_zone_pincodes` each have RLS **enabled** and nonzero policies.
- Menu mutation policy checks restaurant owner/manager role; customer order access and restaurant member access use scoped RLS.
- The `restaurants_guard_approval_fields` trigger rejects non-Platform-Admin changes to onboarding status, approval metadata, `is_published` and `status`. `guard_restaurant_commission_rate` restricts commission updates to Platform Admin. A publication trigger additionally requires active status and at least one available menu item.
- This is a schema/control-plane review; **not** a complete authenticated role-negative E2E browser test. A single linked account is not evidence the Owner APK can authenticate, receive push alerts or manage shifts.

## Photo network audit
- Snapshot: 91 live Hotel Maharani Palace `image_url` values, all `commons.wikimedia.org/wiki/Special:FilePath`, plus missing `Choklet` image.
- Actual Chromium browser audit (GitHub Actions [run #1](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43778375423)) observed **33 loaded**, **58 load-error**. The loaded images were the first 33 in alphabetical order; all following 58 failed in that one concurrent run. This pattern is consistent with possible external-request throttling, but does **not** prove a specific HTTP error. Browser response histograms alone are not sufficient to classify permanently dead links.
- Test code: `scripts/maharani_image_network_audit.py`; manifest: `docs/launch/maharani-image-snapshot-20261116.json`; evidence artifact: GitHub Actions. No production Supabase writes.
- Customer menu currently has a local generic image fallback on `img.onerror`; it does not mean the correct dish photograph loads. Explicit real image and attribution QA remains an open launch gate.

## Production risk reduction completed
- PR [#126](https://github.com/gauravjoshi2999/restaurant-os/pull/126) added a per-dish **typed name confirmation** for permanent Owner menu deletion, and both `id` + `restaurant_id` filters with affected-row verification. QA passed in [Bite QA #962](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43778534069).
- This prevents easy accidental removal but does **not** restore 21 old missing dishes or create historical snapshots. `order_items.menu_item_id` has FK `ON DELETE SET NULL`; for deleted items the order-name snapshot persists but item ID linkage is lost. Proper versioned history/soft-delete is a separate design requirement.

## Gated next actions
1. Confirm address, true pickup location, timing, 313324 service coverage, minimum order and delivery fees with owner.
2. Verify food-photo load under realistic slow mobile/network conditions and review sources/license requirements. Existing Wikimedia notes are not proof of compliant public attribution.
3. Obtain the approved 112-dish price/category source; do not re-add 21 deleted candidates automatically.
4. Keep real Android device E2E, real refunds/splits, delivery OTP and Owner push notification acceptance open.
