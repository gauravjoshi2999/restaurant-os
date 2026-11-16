# Bite Delivery Handoff — Security Control Review (Read-only)
Date: 16 November 2026 (Asia/Kolkata)
Supabase project: `wedbgpybbgsszcmffoha`.

## Directly verified server-side design

- `restaurant_delivery_handoffs` stores `token_hash` (bytea), not cleartext delivery token; `is_active`, `verified_at`, `expires_at`, `otp_attempts` fields are present.
- Default expiry is **24 hours**, default `otp_attempts=0`, default `is_active=true`.
- The table has **no direct authenticated/anon grants** in the inspected grant view and **no row policies**; it is intended to be accessed only through narrow SECURITY DEFINER RPCs. RLS is enabled per earlier inventory (to be rechecked before launch).
- `create_delivery_handoff(p_order_id)`: executable by authenticated role, not anonymous. The function verifies `auth.uid()`, exact restaurant Owner role, order status `Ready` or `Handed Over`, delivery fulfillment and presence of real customer delivery snapshot before generating the link. It deactivates previous active handoff links for that order.
- `get_delivery_handoff(p_token)`: executable by anon/authenticated for the bearer-link flow. Uses SHA-256 token matching, checks active/unexpired/unverified state, and permits only `Ready`/`Handed Over` orders. It returns **customer name, phone and delivery address** to the bearer. This is sensitive data protected by the random link token, so URLs must not be placed in public analytics or support logs.
- `get_my_delivery_otp(p_order_id)`: available to authenticated users only, and function verifies the current user is the order's own customer and link remains active/unexpired/unverified.
- `confirm_delivery_handoff(p_token,p_otp)`: available to anon/authenticated with bearer token; checks `token_hash`, expiry, active state and locks rows for update. After **5 wrong OTP attempts** it raises an error. Each invalid four-digit OTP call increments `otp_attempts` and **returns false**, so the attempt update is not rolled back by an exception. Correct OTP works only after Owner marks order `Handed Over`, then atomically deactivates link and marks order `Completed` with status history.
- All four functions have SECURITY DEFINER, but explicit server-side checks are present in their inspected function source.

## Limits / residual risks
- These are **static code, permission and database default inspections**, not an actual five-failed-attempt test, an end-to-end customer Android trial, a delivered-order completion test, or cryptographic unpredictability measurement.
- The handoff is a **bearer capability** with up to 24h exposure. If its URL leaks, the holder may read customer contact/address until expiry, revocation or completion. Treat URL previews, support tools and analytics carefully.
- The 4-digit OTP has only 10,000 possibilities; five-attempt server protection and sufficiently random link token are essential. Lockout and token expiry should be tested under concurrent requests.
- Before commercial launch, verify link sharing on WhatsApp, one-time reuse protections, expiration, invalid token behavior, competing concurrent confirmations and physical-device UX.

**No production delivery token, customer data, order, OTP or payment was read or modified during this review.**
