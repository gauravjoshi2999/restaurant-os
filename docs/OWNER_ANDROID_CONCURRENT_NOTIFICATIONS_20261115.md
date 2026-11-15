# Bite Partner — Distinct Android notifications for concurrent orders

## What was verified in source
The signed Partner APK's `android-app/patch_bite_fcm.py` generates the native `BiteFirebaseMessagingService.java`. New paid orders use an FCM data payload with a stable order UUID. Cancellation notifications contain the original order UUID *and* a distinct cancellation request UUID.

Previously `NotificationManager.notify(orderId.hashCode(), notification)` used a 32-bit hash. Distinct order UUID strings can theoretically collide on that ID, and a cancellation for the **same** order will definitely replace its existing order notification.

## Code change
- For paid order: `NotificationManager.notify("bite-order-" + orderId, 0, notification)`
- For cancellation: `NotificationManager.notify("bite-cancel-" + requestId, 0, notification)`
- For other messages/tests: `NotificationManager.notify("bite-general-" + messageId, 0, notification)`
- Validate the cancellation request ID (UUID) before showing a cancellation card.
- Repeated notifications about the same order update that order's own card; two different order IDs are independent, regardless of hash collisions.
- Accept/Reject buttons retain the original authenticated, order-specific PendingIntents. Cancellation notifications must not expose direct Accept/Reject actions, as they require reviewing the cancellation request in the Owner app.

## Release limitation
This change is to the **native APK source generator**, not the GitHub Pages website. It will only reach a phone after a new signed Bite Partner APK is built and installed via the existing `.github/workflows/bite-android-signed-manual.yml` release process. WebView auto-refresh cannot replace the compiled native Firebase service in an already installed APK.

## Verification steps for signed release
Use two distinct authorized test paid orders without modifying real customer payments, and one test cancellation against a permitted isolated order. On a real Android phone with notifications permitted, verify that two distinct order notifications are simultaneously visible, each opens its correct order, Accept/Reject handles the chosen order only, cancellation displays its own distinct notification card, and repeated messages for one order update only that card. Compare package/version/signature before installing an updated APK.

Automated Node tests validate the Python-generated Java source contract; GitHub QA does **not** prove native Android build or delivery on a locked phone.
