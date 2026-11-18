# Owner guest controls — 18 November 2026

The existing Owner dashboard design is retained.

- Family check-in requires one lead ID plus one companion ID across the entire booking. Further IDs are optional. Both sides of every attached ID still need verification.
- A family advance is allocated across room folios once, including uncertain-response retries.
- The Check-in card includes today's checkout count. Today and overdue in-house stays appear in Checkouts, and the notification bell links to each guest folio. Existing checkout collection and invoice flows are reused.
- Staff access is configured under Staff. Managers and receptionists default to guest entry, reservations and check-in. The owner can grant additional screens and actions or revoke access. Deletion and permission management remain owner-only. SQL guards also protect direct API attempts.
- Settings → Manage / delete records supports selected hotel stays and bills, guest profiles, room setup, Daily Book entries, hotel expenses, POS drafts, restaurant expenses, unused menu items and unused restaurant tables. Deletion requires a fresh count/hash preview and exact hotel name; retries do not repeat deletion. Related linked restaurant food sales are retained separately and disclosed in the preview. Private deletion snapshots and audit logs remain protected. Saved ID object bytes are not physically purged by SQL; deleting their profile metadata removes future access.

## Verification

- Node regressions: 854 passed locally.
- Existing isolated hotel PostgreSQL setup and scenarios passed.
- New PostgreSQL scenarios passed: four adults / two rooms / two IDs; optional third ID; exact ₹2,000 advance allocation; retry safety; entry-only manager; forbidden payment/checkout/delete/config changes; protected legacy command; grant/revoke; wrong hotel and stale removal preview; dependent stay/folio/entry cleanup; profile and room cleanup; property isolation. All synthetic test data rolls back.
- Chromium scenarios cover 320, 360, 390 and 430px, checkout card → due list → folio, notification → folio, domestic/foreign form placement, family photo flow, permission editing and reviewed removal. GitHub QA is authoritative for these browser results.
- No existing production record is deleted by the migration.
