# B005 — Hotel Maharani Palace menu, photo and room source reconciliation

**Audit date:** 25 November 2026 (Asia/Kolkata).
**Scope:** current production Supabase project `wedbgpybbgsszcmffoha`, restaurant `262aaba7-f48b-4fa5-9ff6-b334ededca84`; archived user-owned menu PDF; pre-existing repository historical audits.
**Nature:** READ-ONLY audit. **No menu/room/publication/price, checkout, refund or customer record was changed.**

## Exact current snapshot

| Area | Production evidence | Interpretation |
| --- | --- | --- |
| Restaurant | Hotel Maharani Palace, published | Published flag does not establish final operator acceptance |
| Menu | **92 rows: 67 available / 25 unavailable** | Existing records; not 112 live |
| Menu price integrity | **0** NULL/nonpositive; **1** ₹1 item | No price validation failures; ₹1 could be test pricing |
| Category integrity | **0** uncategorized, **92** distinct normalized names, **0** duplicate groups | No safe justification for mass catalogue rewrite |
| Category inventory | **13** categories; **Kofta has 0 items** | Do not remove an empty category without approved merchandising decision |
| Photo links | **91 Wikimedia Commons Special:FilePath URLs**, **1 missing** | Link presence is not verified image load, licensing or genuine restaurant photography |
| Photo exception | **Choklet**, ₹1, available, missing `image_url` | Needs actual owner decision on sale visibility/price/photo; do not silently delete or disable |
| Rooms | **7 configured and 7 active**, all housekeeping `ready` | 5 Deluxe, 1 Single, 1 type stored as `Suit` |
| Physical rooms | Historical owner description was **10 Deluxe AC + 1 Suite (11 total)** | Difference from configured 7 is **not independently explained**; do not invent four rooms, auto-rename `Suit`, or assume these floor labels reflect actual building floors |

All values above came from SQL SELECTs, not generated fixtures. The reproducible safe SQL is `docs/sql/maharani_inventory_readonly_20261125.sql`.

## Current catalogue vs archived PDF — exact 92-name/price/availability check

Compared all **92** item labels and their **price and available/unavailable state** from the user's archived `Hotel_Maharani_Palace_Full_Menu_All_92_Items_17_Nov_2026.pdf` against live `menu_items`, joining current category labels:

- PDF rows parsed: **92**, unique normalized names: **92**.
- Current DB rows: **92**, unique normalized names: **92**.
- Names missing from either side: **0**.
- Price mismatches: **0**.
- Availability mismatches: **0**.
- Available count in both: **67**.

**Conclusion:** the current 92-item catalogue has not drifted at the name/price/availability level from the **17 Nov snapshot**. This archived document is an internally generated catalogue, **not the owner-approved pre-deletion 112-item commercial menu**. It cannot authorize restoration.

## Historical 112 vs current 92 — why “just add 20” would be unsafe

Existing source: `docs/launch/MAHARANI_MENU_RECONCILIATION_20261116.md`, with read-only repeatable name comparison `docs/sql/maharani_missing_menu_readonly_20261116.sql`.

- **107** distinct dish labels exist in historic photo-credit files; **five** old surviving names lack those credits.
- Thus **112** candidate original names are plausibly reconstructed, but no approved original prices or categories are proven from credits.
- **21** historic photo-credit names have no normalized current-menu match.
- **91** surviving items were in the 10 Nov original creation batch; **1** newer ₹1 `Choklet` entry was added 15 Nov, leaving **92** current items.
- Therefore **112 minus 92 = 20 net rows**, **not** evidence of exactly 20 approved dishes that should be re-created. The old audit reports Nov 15 menu DELETE/PATCH requests but cannot establish intent, missing price or legitimate authorization.

Do not restore deleted names, change old prices, auto-reactivate the 25 unavailable items, or reset customer order history based on these labels. In particular the 21 candidates have **unverified** sale approval.

## Photo evidence and limitations

`docs/launch/MAHARANI_MEDIA_SOURCE_AUDIT_20261116.md` records 91 external Wikimedia `Special:FilePath` links and an earlier browser image-load run of **33 loaded / 58 failed** under heavy concurrency. This does not prove 58 permanently broken files; it does show that URL presence is insufficient as a launch-quality signal.

- Current live DB metadata alone cannot certify image loading, correct food identity or per-image license/attribution.
- Existing credit notes can guide permissions review, not be used as approval for public third-party image use.
- Next safe code/QA work: bounded sequential external image verification (HTTP/network outcome plus visible image), keeping actual photos and production menu rows unchanged.

## Exact unresolved decisions and gates

1. **Original 112-menu approval:** Need an authoritative owner-approved name/price/category/availability list or owner-by-owner confirmation of the 21 candidate removals. Treat missing items as intentional until a supported correction is authorized.
2. **₹1 Choklet listing:** Owner must decide whether this is a legitimate live dish/price or a past payment test entry, and whether a real photo exists. Do not silently delist or make a fake photo.
3. **Room inventory:** Compare actual property room register (room numbers/types/floors) to the configured seven. Historical 11-key description is not enough to insert four rooms.
4. **Image quality/licensing:** Test all exact current URLs under bounded requests and confirm correct license/credit or replace only with approved restaurant photos.
5. **Signed-in device acceptance:** Owner menu edits, room selection, mobile photography, public QR/customer and role-specific access remain open.

## Completion status

**B005 read-only audit and 92-PDF parity: VERIFIED.** Production **data reconciliation/corrections and real-device acceptance: OPEN / externally dependent**. This is not evidence that the Owner R14/R15/H04 screens or the full Bite platform are accepted.

Next independent engineering priority, even while owner business evidence is missing: add deterministic low-concurrency image/network QA and safe reporting for external media failures (without writing business records), then continue the existing 45 Owner/158 Customer acceptance matrix. No financial action is permitted from this checkpoint.
