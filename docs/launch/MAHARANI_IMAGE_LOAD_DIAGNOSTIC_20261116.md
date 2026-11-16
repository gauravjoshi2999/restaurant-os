# Maharani Palace — Wikimedia Photo Network Verification

Audit window: 16 November 2026 (Asia/Kolkata)
Scope: 91 current `menu_items.image_url` values from restaurant `262aaba7-f48b-4fa5-9ff6-b334ededca84`.
Snapshots/CI: `docs/launch/maharani-image-snapshot-20261116.json`, `scripts/maharani_image_network_audit.py`.

## Verified with real Chromium, no Supabase writes

| Run | Technique | Loaded | Failed |
| --- | --- | ---: | ---: |
| [#1](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43778375423) | 91 images, 5 concurrent load workers | **33/91** | **58** |
| [#2](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43779105861), full job | 91 images, 5 concurrent | **33/91** | **58** |
| [#2](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/43779105861), **separate fresh runner** | **7 of the failed images**, 1 worker + 1.1 s spacing | **7/7** | **0** |

The original full-run outcomes are alphabetical: **first 33 all loaded**, then **all remaining 58 produced `load-error`**; a second independent full run repeated that shape. This strongly suggests bulk-request behavior, quota, throttling or proxy/CDN transport effects, rather than proof that every one of the 58 file links is permanently gone. Seven of those failed links subsequently loaded successfully on another runner. The exact cause (HTTP 429, socket cap, CDN rules, browser platform, etc.) was **not proven**; the response log contained redirects and 200s but not clear error status per failed photo.

Do not claim 91/91 load reliably, that 58 links are permanently broken, or that 7/7 retest proves the other 51 are good. Actual users and devices may behave differently.

Existing Customer Menu already uses native `loading=lazy` and an on-error local food illustration fallback. The full audit intentionally loaded all 91 across five workers and therefore is a stress scenario, not the same as normal scrolling.

## Changes implemented
- Deployed a read-only image-load audit test via PR [#125](https://github.com/gauravjoshi2999/restaurant-os/pull/125).
- Added separate clean-run serial retry diagnosis via PR [#128](https://github.com/gauravjoshi2999/restaurant-os/pull/128).
- Prepared a public photo-credits page (source details for 91 linked dish photos), visible only on the Maharani Customer Menu, via PR [#129](https://github.com/gauravjoshi2999/restaurant-os/pull/129); QA and publication require separate confirmation.

## Still outstanding
- Per-image verification on a physical Android and different networks, including slow/low-memory devices.
- Confirm that each image depicts the right **pure vegetarian** food and does not misrepresent actual hotel cooking.
- Verify the original Commons file pages, exact licenses, required authorship and any adaptations, especially five menu images without a matching earlier credit batch. Public link is helpful but not a substitute for compliance review.
- Owner-approved replacements for images that fail in normal user use; do not invent photograph URLs or blindly change the 91 database URLs.
- Verify that any remaining user-facing image previews, such as cart add-ons and QR menu, have fallback and do not cause excessive parallel requests.

No price, image URL, item, availability, order, payment or bank record was changed during these tests.
