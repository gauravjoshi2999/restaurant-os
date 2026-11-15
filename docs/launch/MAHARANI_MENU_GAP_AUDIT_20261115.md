# Hotel Maharani Palace — Menu Name Gap Audit (read-only)
Date: 15 November 2026 (Asia/Kolkata)
Restaurant ID: `262aaba7-f48b-4fa5-9ff6-b334ededca84`.

## Why this audit exists
The intended menu has been described as **112 dishes**. Live Supabase currently has **92 menu rows**, **67 marked available**, **91 with nonblank image_url**, and **0 with is_vegetarian=false**. A photo URL being populated is not proof that the image loads or is a faithful photograph.

The 9 photo-credit batch files in `assets/menu-maharani/` contain **107 unique dish labels**. This is an *image attribution record*, not the canonical commercial menu or proof that a dish should be sold.

Exact normalized name comparison (lowercase; remove punctuation/spaces) shows:
- **86** credit labels exactly match live menu names.
- **21** credit labels are not currently exact name matches.
- **6** live menu names are not in the credit labels.
- Consequently, the union of these two sources is **113**, not the expected 112; substitutions/renames are plausible. **Do not auto-create or delete any row.**

## 21 photo-credit labels without an exact current menu match
| Label | Batch |
| --- | --- |
| Butter Milk (Chhach) | 02 |
| Chilli Potato | 02 |
| Chinese Bhel | 02 |
| Hakka Noodles | 03 |
| Honey Chilli Potato | 03 |
| Malai Kofta | 04 |
| Paneer Kofta | 06 |
| Soya Chaap | 07 |
| Paneer Pasanda | 08 |
| Pineapple Raita | 08 |
| Veg Navratan Korma (Sweet) | 08 |
| Veg Kofta | 08 |
| Veg Jaipuri | 08 |
| Sweet Corn Soup | 08 |
| Chana Paneer | 09 |
| Mushroom Chilli Dry | 09 |
| Nargis Kofta | 09 |
| Paneer Patiala Shahi | 09 |
| Paneer Peshawari | 09 |
| Paneer Tufani Special | 09 |
| Veg Patiala | 09 |

## 6 live menu names not present in credits
- Choklet
- Dal Makhani
- Paneer Butter Masala
- Veg Biryani
- Veg Grilled Cheese Sandwich
- Veg Sandwich

## Next acceptance actions
1. Locate the actual owner-approved 112-name menu, including each official price, category, availability and veg marking; this is **not** reconstructed from photo-credit files.
2. Resolve renamed/duplicate/removed dishes. A rename should update the existing row and preserve references, not create a second dish.
3. Review the one missing image URL and inspect real image rendering/licensing/appropriateness in the browser.
4. For any genuinely absent approved dish, create only after name/price/category are confirmed and restaurant ownership controls verified.
5. Re-query count, images and labels; get explicit restaurant confirmation. Do not activate sold-out items based on a spreadsheet alone.

This was a **read-only** audit; no price, item, image, availability, payment or live business record was changed.
