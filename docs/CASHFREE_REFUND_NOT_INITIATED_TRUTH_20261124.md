# P0 — Cashfree no-refund-yet truth in every Bite order (24 November 2026)

## Proven problem
Bite's 15-minute read-only status watcher received a Cashfree refund-specific 404 for all three legacy ₹1 jobs, but discarded that evidence. Customer My Orders kept showing only "Refund under review" and Super Admin still said "Gateway awaiting update", although no matching provider refund was present.

A refund-specific 404 **does not prove the entire order has no refund**: a different refund ID might have been used. We must not overwrite real provider PENDING/SUCCESS evidence.

## Corrected evidence and state
1. Signed scheduled service (existing Vault HMAC, issuance switch still OFF) GETs authenticated PAID Cashfree order + exact refund ID. Only when exact ID is 404 does it GET **all refunds for the same Cashfree order**.
2. If the complete provider list is an empty array, the refund job had no previous creation attempt, and exact order / restaurant / customer / amount gates matched, call the service-only idempotent `bite_record_verified_refund_observation` RPC with status `NOT_INITIATED`. If other refund IDs exist, the list fails, or a prior POST attempt is uncertain, do not claim non-initiation.
3. The RPC maintains the internal request status (`pending_approval` or `approved`), records provider_checked_at and provider_status, and **never mutates a payment/refund amount** for `NOT_INITIATED`. A previous non-NOT_INITIATED provider status must not be downgraded, and a prior succeeded refund cannot be reversed.
4. Customer My Orders and Order Details render **Refund not initiated**, explain the Bite request is still under review/approved, show Cashfree checked date and distinguish Bite tracking reference from a genuine Cashfree refund ID. Owner A06 and Super Admin refund list/detail show the same verified state. When a subsequent exact provider refund is observed as SUCCESS, the existing path updates ledger and display automatically.
5. Active Customer/Owner UI refreshes ~30 seconds, Super Admin review ~45 seconds while open/focused. The server watcher runs every 15 minutes independently of all logged-in users.

## Safety and release
- `auto_refunds_enabled` must stay FALSE. No POST /refunds or bank payouts are performed by watcher.
- Never assert bank credit from payment gateway processing success.
- Verify SQL RPC grants: service_role only, no anon/authenticated; synthetic Postgres and Node tests including empty list, competing reference, 503, previous attempts, late no-initiation after SUCCESS.
- Release only after full exact-head GitHub QA: SQL migration **first** (before Edge can call new enum), then Edge `bite-auto-refund` preserving existing auth flags, then Pages frontend cache markers; confirm HTTP 200 counts and exact live browser versions.
- If a future Cashfree refund exists with a different ID, an explicit safe reconciliation process is still needed; do not automatically attach it by amount or customer name.
