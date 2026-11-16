# Bite Partner v17 — Notification Settings / Lock-screen Test

## User-visible symptom
On Restaurant settings, the `Phone notification settings` button displayed a large “Partner APK update karein” toast even when the app could already have been updated. The web frontend called `BiteOwnerPush.openNotificationSettings()`, but the native Android plugin had **no such method**. An unintended numeric `0.` marker appeared before the notification preferences summary. The existing tested `testOwnerLockScreenPush()` function was not accessible through the Settings HTML.

## Fix
- Add native Android `BiteOwnerPush.openNotificationSettings` method. On Android 8+ it opens the specific existing notification channel `bite_owner_new_orders_v1`. If that screen is unsupported, it falls back to the app's Android settings. It never silently grants permission or changes sound settings.
- Replace the false “update app” toast with short, accessible instructions inside the card if running in a browser or on an APK without the new native method.
- Remove the stray ordered list marker from the Settings `details/summary`, preserving the disclosure.
- Surface **Test lock-screen push** beside **Check push health**. It invokes the existing authenticated `bite-owner-push-test` server test, not a paid order, refund or simulated live customer payment. A server `scheduled` response is not phone delivery confirmation.
- Bump signed Android release default `versionCode` from **16 to 17** because this method is compiled into the native APK. The signed Partner release gate now checks the generated plugin Java source for the new method. Website updates alone cannot install this native method.

## Verification gates
- GitHub Bite QA (Node/static/browser/PostgreSQL) passing for the PR, then signed Android release jobs successful (especially **partner**), artifact downloaded, Android install signature preserved, v17 installed.
- From Partner v17, tap **Phone notification settings**; the Android **New restaurant orders** channel should open. Enable phone notifications and configure the sound on the phone. On Android variants with a different Settings UI, use the fallback app notifications page.
- Tap **Check push health**; a registered device still does not prove physical phone delivery. Tap **Test lock-screen push**, then lock the phone and verify receipt. The test must never create a paid order.
- Physical simultaneous-order and Accept/Reject verification remains a separate real Android acceptance test.

No production payment, order, refund or database changes were made by this PR.
