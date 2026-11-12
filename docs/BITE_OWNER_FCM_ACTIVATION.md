# Bite Partner: Firebase push activation checklist

**Current state:** The owner-login / active-WebView alert code works, and the FCM backend + optional Android integration are prepared. Push from a closed or locked app is **not active** until the steps below are completed and verified on a physical Android device.

## 1. Create or select a Firebase project
- In https://console.firebase.google.com register an Android app with **package name `in.bite.partner`** (this must match the installed Bite Partner app).
- Download the Android **`google-services.json`** file. This is the *Android app configuration*, not the Firebase service-account private key.
- In GitHub repository **Settings → Secrets and variables → Actions**, add repository secret:
  - Name: `BITE_FIREBASE_GOOGLE_SERVICES_JSON`
  - Value: the exact content of `google-services.json`.
- The Android workflow supports this raw-JSON secret (or `BITE_FIREBASE_GOOGLE_SERVICES_JSON_BASE64` as an alternative). It must never log the value. Without it, Partner APKs keep the existing active-app alert behaviour only.

## 2. Set private Supabase Edge Function secrets
In Supabase → Project Settings → Edge Functions → Secrets, configure:
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the Google service-account JSON generated in Firebase project settings → Service accounts. **Treat this as a private signing credential: never paste it into chat, GitHub commits, screenshots or frontend code.**
- `BITE_PUSH_DISPATCH_SECRET` — a separate, random, high-entropy secret (32+ characters) for the database webhook to call the dispatch Edge Function.
The FCM HTTP v1 API must be enabled for the Firebase project. Avoid placing service-account credentials in an APK.

## 3. Configure an automatic database webhook
In Supabase → Database → Webhooks:
- Source table: `public.bite_owner_push_events`
- Event: **INSERT** only
- Target: Supabase Edge Function `bite-owner-push-dispatch`
- HTTP method: POST
- Add custom HTTP header `x-bite-push-secret`: the exact `BITE_PUSH_DISPATCH_SECRET` value.
- The dispatch function runs with `verify_jwt=false` but **requires this private header**. It queries only queued events and verifies each eligible paid `Own Platform` order and exact owner mapping.
- Webhook HTTP timeouts and retries should be monitored; the outbox queues events safely until dispatch. Never send a test notification by inserting an unverified paid order.

## 4. Build the real signed Partner APK with FCM
- GitHub → Actions → `Bite Android signed APK (manual and automatic)` → Run workflow
- Use `version_code = 12` or another version higher than the installed version (v11).
- From Artifacts, download `bite-partner-signed-release`; update the old app without uninstalling it.
- Login as the restaurant owner, grant Android notifications, and allow background notifications in Android Settings.
- The Partner Android bridge gets a device FCM token. `bite-owner-push-register` verifies Supabase user authentication and matching `restaurant_members.role='owner'` before saving that token in `bite_owner_push_devices`.
- Log out to revoke the device token locally and unregister it on the server.

## 5. End-to-end acceptance tests (not yet done)
- With Partner app open: a **new, real, paid, non-demo** order appears in the correct restaurant's Overview and receives an alert.
- With Android screen locked or app backgrounded: the new-order push appears and opens the Partner app; check Android battery/push settings.
- Another restaurant owner must never receive the first restaurant's orders.
- Invalid/reused device tokens are disabled. Do not include sensitive customer information in notification text.
- Check `bite_owner_push_events.delivery_status` and Edge Function logs.
- Direct lock-screen **Accept/Reject** is a separate, more sensitive workflow; implement authenticated, idempotent actions only after push delivery works on a locked physical device.
- Force-stopped Android applications are subject to OS and FCM restrictions; no delivery guarantee is possible.

No previous Order/Payment/Settlement records should be altered to test notifications.