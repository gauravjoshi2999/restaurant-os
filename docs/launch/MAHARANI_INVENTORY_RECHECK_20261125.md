# Maharani inventory recheck — 25 November 2026

Read-only production audit on source `3ad0615061f2114bef66f87a98bca293a77c8dfe` (#319).
Restaurant: `262aaba7-f48b-4fa5-9ff6-b334ededca84`.
No menu, photo, price, availability, room, guest, order or financial rows were changed.

| Requirement | Current evidence | Gap and decision |
|---|---|---|
| Historical 112 menu items | Current SQL: 92 rows, 67 available, 25 unavailable; all 92 legacy vegetarian; no new typed metadata | Preserve current rows. A count of 112 is not an approved restoration list. |
| Missing-name reconciliation | Rerunning the [existing read-only comparison](../sql/maharani_missing_menu_readonly_20261116.sql) confirms the same 21 absent photo-credit labels | The [16 November deletion audit](MAHARANI_MENU_RECONCILIATION_20261116.md) already explains 21 absent old names plus one later addition. Do not insert 20 guessed dishes. |
| Actual source approvals | Accessible Library searches found generated menu UI images and the full 4-page `Hotel_Maharani_Palace_Full_Menu_All_92_Items_17_Nov_2026.pdf`; the latter explicitly describes an internal 92-item catalogue copied from the database | Neither is an original pre-deletion approved commercial menu. Prior-chat recovery locates a request based on five uploaded menu photos, but their original complete source/price list was not recovered in this audit. Intentional deletion/availability decisions remain unconfirmed. |
| Photo links | 91 nonempty URLs, all Wikimedia Commons Special:FilePath; the remaining available item is Choklet at ₹1, with no image URL | Do not invent its photo, change its price or hide it based on an assumption. Obtain an actual item/photo/visibility decision before a paid pilot. URL presence alone does not certify image load, licence, dish identity or restaurant ownership of a photo. |
| Room inventory | 7 active rooms: 102, 103, 104, 105, 107, 108, 109. Current types: 5 Deluxe, 1 Single, 1 Suit | Prior 10 Deluxe + 1 Suite description is not a verified current numbered inventory. Do not manufacture rooms or silently rename existing types. |
| Room audit coverage | 10 `room_save` events reference 7 distinct room IDs; none of those IDs is absent from current rooms | The recorded save history does not demonstrate four deleted rooms. Actual physical inventory/configuration still needs operator evidence. |
| Existing menu history | Both menu_items and menu_categories already have `bite_property_operation_audit` triggers. `bite_audit_control_change()` captures before/after rows. The scoped unified audit resolves their restaurant IDs | Reuse this implementation. No matching historical menu snapshots exist; installing another trigger cannot reconstruct the earlier Nov 15 deletions. No new audit table/trigger is needed. |

The same 21 absent labels remain listed in the linked historical audit; it is a detection list, not permission to sell those dishes. The 25 unavailable rows were not reactivated.

## Safely executable R14 correction

The existing menu modal had an immediate close with no unsaved-change decision and only an image URL input. Owner PDF R14 / p29 explicitly requires editor recovery plus photo preview/remove/retry. B005 implements these in that same editor:

- Close, backdrop and Escape offer Save changes / Discard changes / Keep editing. Browser unload protection applies to an active dirty/pending editor; drafts are not persisted across users in local/session storage.
- A pending save freezes fields and blocks dismissal; failed/zero-row saves retain the draft. Only a confirmed single-row existing scoped mutation marks it clean. Session/tenant changes clear the previous editor; stale save completions cannot clear a later draft.
- Preview uses the selected image URL. Retry, restore saved URL and remove are form edits until explicit Save. New replacement URLs must be valid HTTPS (or same-origin asset paths) and have loaded in the current preview; a failed new image cannot overwrite the saved URL. An unchanged old image host failure does not block unrelated item corrections.
- Preview never identifies a dish or certifies its dietary suitability. The Owner must check it. No upload endpoint, Storage deletion, public photo replacement, financial action or production menu edit is introduced.

This is partial R14 completion. File upload, image-rights/dish review, original commercial restoration decisions, signed-in Owner/Manager and physical-device acceptance remain OPEN.

## Validation and release journal

Local: 1,253 Node tests passed, including 9 new editor behavior cases; frontend/Owner structure checks, 12 deployment safety tests, public packaging, Python syntax and whitespace checks passed. Local Chromium execution was blocked by the missing installed browser binary. A dedicated actual-modal/open/close/save Chromium fixture was added for 320/360/390/430/1440px; CI execution and exact-head production release remain PENDING at this source checkpoint.

The post-publication B005 journal in [launch ledger #216](https://github.com/gauravjoshi2999/restaurant-os/issues/216) and its linked PR records exact reviewed/merged SHA, CI, Pages and live source parity. Consult it before repeating work. No Supabase migration is required for B005.

**NEXT:** finish B005 release evidence, then progress the next independently executable Owner/Customer acceptance gap. Commercial menu restoration, Choklet approval/real photo and numbered room inventory remain externally blocked on authoritative business evidence. Do not repeat #315–#319 or apply the already-recorded dietary migration again.
