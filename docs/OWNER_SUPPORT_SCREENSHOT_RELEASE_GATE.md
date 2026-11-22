# Owner support screenshots — release gate

The bucket is private. Do not activate the frontend in production until the following checks pass using an isolated Supabase Storage API environment with synthetic tickets and images. Do not use real guest identity documents, payment receipts, or production account secrets.

## Permission matrix
- Ticket owner (correct restaurant, open ticket): upload one JPEG/PNG/WebP within 3 MiB; list and download only that ticket's screenshot.
- Same owner, closed ticket: download existing screenshot, but new upload refused.
- Different owner or restaurant, staff, signed-out/anonymous client: cannot list, download, upload, overwrite or delete the screenshot.
- Authorized platform admin: list/download only; no upload, overwrite or deletion.
- Any browser user: alternate file paths, MIME outside whitelist, files above size limit, upsert and move/delete denied.
- Unrelated menu and guest-document storage permissions unchanged.

Use the actual Storage API, not direct SQL writes to storage.objects. Include network-loss retry and logout/account switch while download is pending. Record status codes and synthetic fixture IDs only. Never log access tokens or screenshot contents. Confirm private URLs fail without an authenticated authorized client.

## Retention and deployment
An owner and platform operator must agree on the retention period, secure deletion authority and privacy information before collecting screenshots. No automatic deletion or new service credential is introduced in this candidate. Verify cleanup via supported Storage API rather than deleting metadata directly. Use an isolated test environment; do not create paid resources without cost approval.

After successful API tests, confirm current Main and exact candidate QA; apply the reviewed versioned migration once, verify bucket and RLS, then release the frontend. If security verification fails, withhold upload UI and do not accept production screenshots.

## Current preflight
Production SQL read-only preflight: support bucket absent, support policies absent, storage RLS enabled. Existing PostgreSQL fixture tests passed on earlier candidate. No signed-in Storage API test has been performed. A fresh integration QA and the API permission matrix remain mandatory.
