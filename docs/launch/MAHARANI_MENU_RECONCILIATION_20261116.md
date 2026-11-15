# Maharani Palace — 112-item menu reconciliation and deletion timeline

**Read-only audit, 16 November 2026 (Asia/Kolkata).**
Restaurant: Hotel Maharani Palace, Rajsamand. ID: `262aaba7-f48b-4fa5-9ff6-b334ededca84`.
No menu items, prices, availability, customer orders or payment records were modified.

## What is verified

| Finding | Verified evidence |
| --- | --- |
| Current menu | **92** rows: **67 available, 25 unavailable** |
| Original created batch still present | **91** rows created together on **2026-11-10 09:46:10 UTC** |
| New row | **Choklet**, ₹1, added **2026-11-15 11:31 UTC**; it is available and has no image URL |
| 15 November availability changes | **25** currently unavailable rows updated between **09:15 and 09:35 UTC**; the row timestamps show a concentration around 09:22–09:28 UTC |
| Menu categories | **13**, including **Kofta with 0 remaining items** |
| Photo-credit history | 9 files under `assets/menu-maharani/`, containing **107 distinct dish names** |
| Matched historical labels | **86** photo-credit names still exactly match current rows after punctuation/case normalization |
| Candidate missing names | **21** names in the photo-credit history but not the live menu, verified with `docs/sql/maharani_missing_menu_readonly_20261116.sql` |
| Existing old menu names absent from photo credits | **5**: Dal Makhani, Paneer Butter Masala, Veg Biryani, Veg Grilled Cheese Sandwich, Veg Sandwich |
| Historical 112 hypothesis | **107 photo-credit names + 5 old non-credit live names = 112**. Current old rows are 91, plus 1 newer Choklet = 92. This is a convincing name-level reconstruction, but *not* a recovered approved price/category/availability list. |

## Server-side action evidence
Supabase unified **edge logs** for **15 November 2026, 08:30–12:30 UTC** show a sequence of successful HTTP **DELETE 204** requests on individual `/rest/v1/menu_items?id=eq.<uuid>` endpoints between approximately **09:21:40 and 09:26:46 UTC** (**14:51–14:56 IST**). Numerous **PATCH 204** requests to individual menu items occurred during the same window. One **POST 201** to `/rest/v1/menu_items` is visible at **11:31:21 UTC**, aligning with the newly created Choklet row.

The request user-agent string indicates **Android 13 WebView** traffic for these mutations. That does not identify the person operating the device or establish whether these changes were deliberate. An HTTP 204 does not, on its own, prove every request removed a row. These logs corroborate that destructive menu requests happened, rather than merely a display/filter bug.

Existing `bite_operation_audit` and `platform_audit_logs` contain no matching menu-delete snapshots; the deleted rows' price/category/history are not available from these audits. Names reconstructed from photo-credit documents do not carry reliable prices.

## 21 absent historical photo-credit names

| # | Candidate missing dish | Price | Restoration status |
| --- | --- | --- | --- |
| 1 | Butter Milk (Chhach) | unverified | **Do not restore automatically** |
| 2 | Chilli Potato | unverified | **Do not restore automatically** |
| 3 | Chinese Bhel | unverified | **Do not restore automatically** |
| 4 | Hakka Noodles | unverified | **Do not restore automatically** |
| 5 | Honey Chilli Potato | unverified | **Do not restore automatically** |
| 6 | Malai Kofta | unverified | **Do not restore automatically** |
| 7 | Paneer Kofta | unverified | **Do not restore automatically** |
| 8 | Soya Chaap | unverified | **Do not restore automatically** |
| 9 | Paneer Pasanda | unverified | **Do not restore automatically** |
| 10 | Pineapple Raita | unverified | **Do not restore automatically** |
| 11 | Veg Navratan Korma (Sweet) | unverified | **Do not restore automatically** |
| 12 | Veg Kofta | unverified | **Do not restore automatically** |
| 13 | Veg Jaipuri | unverified | **Do not restore automatically** |
| 14 | Sweet Corn Soup | unverified | **Do not restore automatically** |
| 15 | Chana Paneer | unverified | **Do not restore automatically** |
| 16 | Mushroom Chilli Dry | unverified | **Do not restore automatically** |
| 17 | Nargis Kofta | unverified | **Do not restore automatically** |
| 18 | Paneer Patiala Shahi | unverified | **Do not restore automatically** |
| 19 | Paneer Peshawari | unverified | **Do not restore automatically** |
| 20 | Paneer Tufani Special | unverified | **Do not restore automatically** |
| 21 | Veg Patiala | unverified | **Do not restore automatically** |

Only two of these names matched any historical order-line snapshot, which is not an authoritative current menu price source. Old food-photo credit files contain illustrative third-party images, not necessarily pictures of Hotel Maharani Palace's own dishes. Do not treat a photo credit as restaurant consent to sell a dish.

## Operational precautions
1. **Do not re-create these 21 rows with invented prices, categories or availability.** Deletions might have been intentional.
2. **Do not reactivate the 25 unavailable dishes automatically.** The disabling may reflect genuine kitchen availability.
3. **Review the ₹1 available Choklet row before a paid public pilot.** A test-priced item should not accidentally become a real order unless approved.
4. Preserve the 92 current rows and any related records. For recovery, use a verified pre-deletion backup/approved menu source and owner-authorized forward-only correction, never blanket rollback or speculative data writes.
5. Add a durable menu deletion safety improvement as a separate reviewed task: clearly label destructive removal, encourage Pause/Unavailable, require explicit per-item confirmation, and consider versioned audit history.
6. Run `docs/sql/maharani_missing_menu_readonly_20261116.sql` again after any approved corrections; verify no other restaurant was affected.

## Task states
- **6.08b physical Android + live server write/readback** — remains OPEN. CI's Chromium mobile emulation passed previously, but no phone was controlled in this session; no synthetic live survey was sent.
- **6.09a name-level difference and evidence** — COMPLETE (21 candidates documented with exact live SQL comparison and log timeline).
- **6.09b approved commercial menu restoration** — BLOCKED on verified names/prices/category and an explicit decision about intentionally removed items.
- **6.10a current availability/timestamp evidence** — COMPLETE (25 unavailable, correlated with Nov 15 updates).
- **6.10b intentional sold-out confirmation** — OPEN (cannot infer kitchen intent from database flags).
