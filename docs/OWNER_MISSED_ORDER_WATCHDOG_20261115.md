# Bite Partner — Missed Realtime Order Watchdog (15 Nov 2026)

## Why this is needed
The previous foreground retry checked payment-pending IDs only after a database INSERT was already received. A dropped Supabase Realtime INSERT (without connection closure) could therefore leave the Owner looking at a stale board. A network reconnect was not guaranteed to fire in that scenario.

## Scope of change
- While the authenticated Owner app is **visible and online**, perform a read-only **30-second** backup query against **only their restaurant** and only `Received`, non-demo, `Own Platform` orders.
- Return a maximum of **200 most recent Received rows** and compare stable order IDs against the loaded board. Never trust another restaurant's rows even if the database returns them unexpectedly.
- Queue every newly discovered ID once and use the existing snapshot/reconciliation flow. Alerts require independent **verified-paid financial records**, exact Owner tenant and `Received` status. Delay/failed payment verification does not generate an Owner new-paid-order alert.
- Keep the 30-second payment verification retry via the same existing pending-ID tracker, without a second large 12-table full refresh for every interval.
- Skip polling if hidden, offline, not Owner, no restaurant membership, or a full refresh/catch-up/poll is active. Confirm that the authenticated user and tenant did not change before acting on results.
- No new server permissions, database schema, payment/order writes, refund jobs, or notification pushes are created by this step.

## Limits, operator expectations and next release gates
- This is a **foreground failover**; browsers suspend timers and WebViews when Android is locked, killed, or force-stopped. **Firebase Cloud Messaging is still necessary**, and FCM submission does not prove phone delivery.
- The 30-second interval is not a delivery/acceptance guarantee. Android battery restrictions, Supabase query failures, event ordering and device connectivity can delay alerts. The 200-row page is a bounded single-poll scope, not an unlimited backlog audit.
- Existing overdue order warnings and accepted-status history remain unchanged. No automatic cancellation/refund/reordering is authorized.
- Validate with a real signed Partner APK: 2/5/20 safely isolated test orders (no live payment), deliberate Realtime disconnection while app is visible, reconnection and dedupe, then one separately approved legitimate paid order with app locked/unlocked. Ensure only the intended restaurant's owner sees it and no app shows a duplicate action.
- Confirm exact GitHub Pages deployed SHA and installed Partner APK version before calling this fully live. Any deployed Edge Function source or cron change needs separate server-side review.
