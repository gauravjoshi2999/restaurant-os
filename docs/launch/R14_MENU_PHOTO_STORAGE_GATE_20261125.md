# B007 — R14 menu-photo file-upload and Storage role gate

**Source inspection:** 25 November 2026 (Asia/Kolkata), repository `gauravjoshi2999/restaurant-os`, Supabase `wedbgpybbgsszcmffoha`.
**Scope:** execute the next independent P1 after live B006/#321 in `docs/BITE_MASTER_COMPLETION_TRACKER.md`. **Read-only access/security audit; no production upload, menu mutation, new RLS policy, bucket reconfiguration, payment or guest access.**

## Latest release evidence

- B006 R14 unsaved-edit/photo-URL recovery [#321](https://github.com/gauravjoshi2999/restaurant-os/pull/321) **merged** as `4b508885889af268e9271834eb8fe5ca22e3957e`.
- [Exact-main QA run #45558827310](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/45558827310) **13/13 success**, including static/Chromium; [Pages run #45559834297](https://github.com/gauravjoshi2999/restaurant-os/actions/runs/45559834297) **success** for the same SHA.
- This is **software-deployment evidence only**, not signed-in Owner/Manager/phone acceptance.

## Existing R14 functionality, not a file upload

- `index.html` `#menuItemForm` contains `image_url` (HTTPS URL), `#menuItemPhotoPreview`, Retry, Remove, Restore buttons and close/discard/draft recovery. It contains **no menu-photo file picker**.
- `assets/owner-menu-editor.js` previews URLs and prevents saving a newly changed URL without a successfully loaded image. It performs **no Storage upload**. Remove means clear a draft URL, not delete an object.
- `index.html` menu Save writes one scoped `menu_items` row (`id` plus `restaurant_id`) after validation. `menuEditScope` permits restaurant Owners **and Managers** to edit menu metadata.
- There is an **existing separate Owner restaurant-cover uploader** in `index.html`: compresses to WebP, stores under `{restaurant_uuid}/covers/{uuid}.webp`, calls `sb.storage.from('bite-menu').upload(..., { upsert:false })`, then updates cover path. Do not conflate cover-photo upload with dish-file upload or reuse its forced 16:9 cover crop for menu dishes without design review.

## Actual production Storage capability

Live read-only queries checked `storage.buckets`, `pg_policies` **including `permissive`**, `pg_class`, `information_schema.role_table_grants`, `restaurant_members` aggregate and `storage.objects` aggregate.

| Boundary | Verified state | Implication |
| --- | --- | --- |
| Bucket `bite-menu` | **public=true**, max **5 MiB (5,242,880 bytes)**, JPEG/PNG/WebP MIME only | Public image download is not permission to upload |
| Existing objects | **2** in `bite-menu`, both in `covers/`; **0** with `/menu/` prefix | There is no evidence of a production R14 dish-file upload |
| `bite_assets_insert` | **PERMISSIVE INSERT** for `authenticated`, bucket `bite-menu` or `bite-private`, tenant UUID first folder and `has_restaurant_role(restaurant_id, ARRAY['owner'])` | Scoped **restaurant Owner** may upload; **Manager, Staff and anonymous** do not pass this positive grant |
| `has_restaurant_role` | Checks actual `restaurant_members` against `auth.uid()` and excludes platform-admin path | Browser `access.role='owner'` alone is **not** proof of Owner Storage upload permission, especially for property Manager contexts |
| `bite_assets_read` | Authenticated Owner or Platform Admin within scoped bucket path | Public `bite-menu` image URL may be fetched through normal public Storage serving, independent of private list/query rights |
| `bite_assets_delete` | Authenticated Owner within scoped prefix | Cleanup must be Owner-scoped and never delete images from unrelated rows |
| UPDATE / overwrite | `guest_docs_no_replace` is **RESTRICTIVE** for non-guest buckets, but **no PERMISSIVE UPDATE grant** on `storage.objects` | Do not rely on `upsert:true`. Unique new UUID path + `upsert:false` is the supported approach |
| `guest_docs_*_boundary` | **RESTRICTIVE**, including anonymous boundary; they narrow access, not grant it | **No inferred anonymous write vulnerability**. Their permissive-looking expressions cannot authorize a mutation by themselves |
| Actual R14 HTTP upload | **Not exercised** (no signed-in Owner/Manager token used) | SQL policy evidence is a permission-design audit, not successful real authenticated API acceptance |

Production `restaurant_members` currently has five Owner role rows, no Manager memberships; this does not certify a future Manager.

Official Supabase Storage [access-control documentation](https://supabase.com/docs/guides/storage/security/access-control) confirms INSERT permission plus RLS for upload; UPDATE+SELECT are additionally needed for upsert. In this project both table grants **and the applicable permissive/restrictive policy combination** must be checked before offering an upload control.

## Decision and next bounded implementation

**Audit gate complete:** It is safe to *design* **Owner-only** R14 file upload without new Storage grants, but **not** to claim Managers can upload or to claim the feature is implemented today. Do not broaden the existing Storage policy merely to make a Manager button work.

Next independently executable P1 increment: add an Owner-only JPG/PNG/WebP picker inside the **existing** R14 `menuItemModal` for **already-saved items**, checking real restaurant `restaurant_members` Owner association, not just UI role; enforce 5 MiB limit and decode/dimensions, optional safe WebP optimization, explicit public-photo/rights confirmation and secure tenant-scoped `{restaurant_uuid}/menu/{item_uuid}/{random_uuid}.{extension}` uploads with `upsert:false`. Only after server upload success and one-row scoped `menu_items` Save should the replacement URL become the saved record; on failure retain the original URL/draft and clean up only the *newly created* unreferenced object when authorized. Never remove existing external Wikimedia URLs; do not overwrite/delete user-owned storage files on uncertain state.

Acceptance must cover invalid/oversized/spoofed images; Owner vs Manager vs cross-tenant/anon permissions; retry, optimistic save conflict, revoked session mid-upload, slow mobile/camera, storage error cleanup, image rights, and 320/360/390/430/1440px UI. Use synthetic isolated fixtures for write-path testing before any real upload, and obtain a genuine Owner session for production authorization/phone acceptance.

**Current B007 result:** Audit evidence VERIFIED; R14 file uploader NOT IMPLEMENTED; Owner-only future route feasible under current policies; Manager upload BLOCKED by design unless separately approved. R14 Owner screen **not ACCEPTED** by this audit. Preserve B005 and B006 deployments, all existing menu rows and the 45-screen/158-control checklist.
