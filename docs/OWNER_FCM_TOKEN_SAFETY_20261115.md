# Bite Partner — Firebase token safety (15 November 2026)

## Production issue
The Owner new-order and cancellation push senders previously disabled an installed Partner APK token after **any** FCM HTTP 400 or 404 response. FCM HTTP 400 can also mean invalid message data, a malformed payload, or other request mistakes; the token itself may be healthy. If the currently sole enabled Owner phone were disabled for a payload bug, all subsequent real order notifications could go missing.

Firebase official documentation distinguishes the FCM v1 `FcmError` detail from the generic `google.rpc.BadRequest` detail; an HTTP status by itself is not enough to prove a token invalid:
- https://firebase.google.com/docs/cloud-messaging/error-codes
- https://firebase.google.com/docs/cloud-messaging/manage-tokens

## Change
- Add `fcm-token-policy.mjs` (pure and tested) for both server-side Push senders.
- Disable a token **only** when Firebase explicitly returns typed FCM `UNREGISTERED` on HTTP 404, or an FCM-specific `INVALID_ARGUMENT` on HTTP 400 with an explicitly invalid registration-token message and no `google.rpc.BadRequest` detail.
- Preserve the current finite retry budget, per-owner membership isolation, verified `paid` guard, cancellation-only role checks, existing scheduled dispatch secrets and SMS/FCM payloads.
- Never interpret an arbitrary 400/404, unknown JSON or networking problem as permission to disable a Partner phone.
- Fail closed for *token deactivation* on unparseable/ambiguous responses: the outbox may still record a send failure and schedule a bounded retry. This rule does not accept unpaid orders, replay already completed events or claim Firebase-to-phone delivery.

## Release protocol
1. Run all Bite QA, Node regression tests and database regression workflows in GitHub.
2. Fetch live Supabase `bite-owner-push-dispatch` and verify its full source/dependency files are the intended pre-change version; do not overwrite an unrelated hotfix.
3. Deploy the four source files with the exact existing `verify_jwt=false` setting (private cron secret or Vault-key verification stays in the function).
4. Fetch deployed function again to verify source, version and `verify_jwt`. Read-only check of outbox status counts, enabled devices and cron status.
5. Do **not** enqueue or replay historical orders, produce real test payments, or trigger refunds. On a physical signed Partner APK, test incoming real paid orders and cancellation with lock-screen/notification permission when an authorized end-to-end test is possible.
