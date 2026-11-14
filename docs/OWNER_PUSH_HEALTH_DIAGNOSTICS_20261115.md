# Bite Partner — real-order push health diagnosis
15 November 2026

## What production read-only verification found
The existing production Supabase project `wedbgpybbgsszcmffoha` already has:
- Active `bite-owner-push-register`, `bite-owner-push-dispatch`, and `bite-owner-push-test` functions;
- An enabled `orders` table push enqueue trigger;
- 4 push outbox events marked **sent**, 1 marked **failed** (5 attempts);
- 1 enabled native action-capable device token; 2 disabled action-capable devices;
- 0 currently `Received` + `paid` real Own Platform orders, so **no live test order was created and no historical event was replayed**.

These are snapshots, not proofs that any phone actually displayed the order. A `sent` row means FCM submitted/accepted in the dispatcher, not device delivery; a local WebView test notification is also not an end-to-end push verification.

## Implementation
- New Edge Function `bite-owner-push-health` is **read-only** and `verify_jwt=true`.
- Revalidates Supabase Auth using the signed-in user's token. Uses server-side membership lookup for the exact `user_id` + `restaurant_id` and `role='owner'` before privileged reads. It never relies on user-editable JWT metadata.
- Queries only the user's own restaurant's device metadata and recent outbox statuses. The service key is server-only; neither raw FCM tokens nor order/customer IDs, restaurant membership details, or FCM credentials are sent to the browser.
- Returns strict aggregated counts: registered/enabled/recent/action-capable Partner devices, sampled event counts for sent, queued, retry, processing, failed and no_devices; **phone delivery is always NOT_VERIFIED**.
- Adds one button in the existing Owner Settings **Notifications & Sound Preferences** area, not another duplicate dashboard navigation page. Nothing runs automatically, so a browser login won't test-send FCM.
- Session/account switch and logout invalidate the pending result and unblock the button.
- Node tests verify aggregation privacy, non-owner denial, invalid responses and asynchronous account switch. Existing Chromium + PostgreSQL QA still run.

## Diagnosing real orders
After the change is deployed, the restaurant Owner can open Bite Partner > Settings > Notifications & Sound Preferences > **Check push health**:
- No active device: Open signed Partner APK, confirm notification permission, open app with Internet and refresh.
- Active device but no recently seen token: Open Partner app; this is informational because old timestamp does not prove device delivery failed.
- Failed/pending events: Investigate push dispatch, Firebase availability, Android notification channel and device restrictions. Do **not** replay paid orders without verifying they are still new/unprocessed.
- Sent events: Check Android notification receipt in the foreground/background/locked screen independently; server FCM submission is not device acknowledgment.

## Not changed
No payments, refunds, new orders, customer notifications or FCM test pushes were executed. No database schema, triggers, RLS or live financial ledger were modified. Existing push registration/dispatch and push test logic remain untouched.

A production function deployment and exact GitHub Pages release check are still required after green PR QA. Android installed APK compatibility requires a real device acceptance test.
