# Bite Partner v16 — Signed Firebase Build Gate

## Verified problem
The current signed APK workflow invokes `android-app/patch_bite_fcm.py`, which exits successfully if neither Firebase Android configuration secret is supplied. A signed Partner APK could therefore be uploaded without any native lock-screen order notifications, although GitHub Actions reported success. Customer and Admin apps intentionally do not include the Partner Firebase service.

## Fix
- For the **Partner** job only, require at least one configured Firebase Android `google-services.json` secret before applying the native patch.
- Fail the job if the config file or generated `BiteFirebaseMessagingService.java` is missing.
- Verify the generated **Java** service—not just the Python source—contains `NotificationManager.notify(tag, 0, ...)`, a distinct cancellation request tag, and the order-specific Accept/Reject intents.
- Verify the service is present in the Android manifest, before assembling or signing the APK.
- Keep Customer/Admin builds separate; never expose, echo, upload or commit Firebase configuration data. No money, refund or live order changes.

## Verification and remaining gate
Node/static QA confirms the release workflow contains these checks. A successful signed build still requires Android SDK/Gradle, configured signing secrets, and a real GitHub Actions run; this is **not** proven by merging the workflow. On a physical Android phone with notification permission, confirm that two distinct paid-order notifications remain separate while locked, the correct order opens for each, and cancellation stays separate. Website auto-refresh does not modify the already installed native APK.
