# B006 — existing R14 editor recovery and photo preview

Source baseline: `3ad0615061f2114bef66f87a98bca293a77c8dfe` (#319). Approved behavior: Owner PDF R14 / p29.

## Inventory audit reuse

The inventory reconciliation was merged in [PR #320](https://github.com/gauravjoshi2999/restaurant-os/pull/320) / B005 at `a3f76cbd2113c8abf6565facd133d0a17f9ad1f0`. See [its canonical report](MAHARANI_INVENTORY_RECONCILIATION_B005_20261125.md). Reuse its source report and SELECT-only script; do not create a second restoration task or claim that generated UI/catalogue artifacts approve deleted dishes. This session independently rechecked the same 92 / 67 available / 25 unavailable menu counts, 21 absent historical names and Choklet at ₹1 without photo. No business rows were changed.

Additional current metadata: ten room-save events reference exactly the seven configured room IDs; none is absent from current rooms. Menu/category before/after audit triggers and scoped audit resolution already exist; no duplicate trigger is needed. These facts do not establish the physical room inventory or recover deleted commercial data.

## Safely executable R14 correction

The existing menu modal had an immediate close with no unsaved-change decision and only an image URL input. Owner PDF R14 / p29 explicitly requires editor recovery plus photo preview/remove/retry. B006 implements these in that same editor:

- Close, backdrop and Escape offer Save changes / Discard changes / Keep editing. Browser unload protection applies to an active dirty/pending editor; drafts are not persisted across users in local/session storage.
- A pending save freezes fields and blocks dismissal; failed/zero-row saves retain the draft. Only a confirmed single-row existing scoped mutation marks it clean. Session/tenant changes clear the previous editor; stale save completions cannot clear a later draft.
- Preview uses the selected image URL. Retry, restore saved URL and remove are form edits until explicit Save. New replacement URLs must be valid HTTPS (or same-origin asset paths) and have loaded in the current preview; a failed new image cannot overwrite the saved URL. An unchanged old image host failure does not block unrelated item corrections.
- Preview never identifies a dish or certifies its dietary suitability. The Owner must check it. No upload endpoint, Storage deletion, public photo replacement, financial action or production menu edit is introduced.

This is partial R14 completion. File upload, image-rights/dish review, original commercial restoration decisions, signed-in Owner/Manager and physical-device acceptance remain OPEN.

## Validation and release journal

Local: 1,257 Node tests passed, including 10 new editor behavior cases; frontend/Owner structure checks, 12 deployment safety tests, public packaging, Python syntax and whitespace checks passed. Local Chromium execution was blocked by the missing installed browser binary. A dedicated actual-modal/open/close/save Chromium fixture was added for 320/360/390/430/1440px; CI execution and exact-head production release remain PENDING at this source checkpoint.

The post-publication B006 journal in [launch ledger #216](https://github.com/gauravjoshi2999/restaurant-os/issues/216) and its linked PR records exact reviewed/merged SHA, CI, Pages and live source parity. Consult it before repeating work. No Supabase migration is required for B006.

**NEXT:** finish B006 release evidence after reconciling B005 / #320. Then audit existing R14 file-upload/Storage role capabilities without weakening policies or exposing private guest/support files. Commercial menu restoration, Choklet approval/real photo and numbered room inventory remain externally blocked on authoritative business evidence. Do not repeat completed releases or apply the already-recorded dietary migration again.
