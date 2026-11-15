# Bite Partner — bounded late-registration push retry (16 Nov 2026)

## Proven defect
If no enabled FCM device existed when a legitimate paid new-order or pending cancellation outbox item was processed, the dispatcher set `no_devices` permanently. If an Owner signed in or updated Partner shortly afterwards, no pending outbox retry remained. This could hide an otherwise actionable request until the Owner opened the dashboard.

## Scoped fix
- Keep events in `retry` for **at most 15 attempts or 25 minutes**, whichever ends first, if the only issue is that no enabled Partner device was registered.
- At each retry, re-read the actual order, restaurant membership and paid state. For cancellation also re-check the exact pending request and matching customer/restaurant. If an order is no longer eligible, do not push.
- No actual order, refund, ledger, customer payment, payout, or database schema is touched. The dispatcher is still server-secret authenticated and intentionally `verify_jwt=false` with its existing private authorization.
- After expiry, `failed` with an aggregate-safe reason; **never** requeue historical terminal events automatically.
- This is a preventive improvement. Current read-only production showed one enabled device and no queued/retry events; it does not prove real Android delivery.

## Release gates
1. Merge only when exact PR SHA has green static/browser and PostgreSQL QA.
2. Before edge deploy compare live Supabase dispatch source/dependencies against parent main to prevent overwriting hotfixes.
3. Deploy the original entrypoint and **all** relative files, preserving existing `verify_jwt=false` and private secret guards.
4. Fetch deployed function source/version again and confirm no data mutations from deployment.
5. Actual locked-screen and background acceptance needs a signed Partner APK and a legitimate paid order. Do not create charge or refund merely to test notifications.

## Operator blocker
Three older device registrations remain disabled; the Owner must log into a signed and up-to-date Partner APK with notification permission. A successful Firebase submission does not prove the OS showed a banner or action buttons.
