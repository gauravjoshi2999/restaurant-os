# Bite Partner — Local versus server Push Health (16 November 2026)

## Problem
The Owner's **Check push health** button reported server-side registered devices without checking whether the phone running the current screen actually exposed the compiled native Push bridge. A server count of 1 enabled device does not necessarily mean the user's current phone has the latest APK or permissions. This was confusing after the Native v17 Settings update.

## Safe UI-only improvement
- On the **existing** manual Push Health action, inspect only whether the local JS Android bridge exposes `BiteOwnerPush.enable` and `openNotificationSettings`.
- Show distinct **This device** and **Server** statuses. The local bridge check makes no Firebase call, reads no token and cannot confirm permission or delivery.
- Preserve the existing authenticated, tenant-scoped, read-only `bite-owner-push-health` request and strict response validation. Do not expose customer/order/FCM-token data.
- Continue saying **Phone delivery NOT verified** even if Firebase submission count and device capabilities look healthy.
- Do not introduce a duplicate nav page, new APK dependency, background service, order payment, refund, or device mutation.

## Verification
Automated tests verify browser/older Partner bridge, native Partner with and without the v17 Settings capability, tenant isolation, invalid response handling, and accounting clarity. The source is merged/deployed only after green GitHub QA. Actual locked-screen receipt still requires the physical phone test; the repo/CI status does not prove delivery.
