# Maharani Menu Media — Read-only Source Audit

Date: **16 November 2026 (Asia/Kolkata)**. Scope: restaurant `262aaba7-f48b-4fa5-9ff6-b334ededca84`.

## Verified Supabase state
- 92 menu rows total.
- **91 rows** have a nonblank `image_url`; all 91 URLs use **`https://commons.wikimedia.org/wiki/Special:FilePath/...`** (with `?width=720`).
- **1 row** has no image URL: **Choklet**, a new ₹1 available item created on 15 November.
- The database does not store an image-load result, a source-license verification result, or a claim that photos depict food produced at Hotel Maharani Palace.
- The nine `assets/menu-maharani/PHOTO_CREDITS_BATCH_*.md` documents are photo-attribution research notes, not conclusive public-facing attribution.

## Important limits
- A nonblank Commons link **does not prove that the image currently loads**. The `Special:FilePath` route redirects; redirects/CDN failures, image format, browser CSP and mobile network behavior need actual runtime testing.
- A photograph of a similar dish is not the actual restaurant dish. Some source records explicitly describe substitutes or close matches.
- Wikimedia Commons licenses vary and often require the author/source/license to be visibly attributed to customers, including edits or adaptations where applicable. Project documentation alone is not necessarily sufficient.
- The checked-out customer page has a `BiteDiscovery.safeImage` URL sanitizer and an onerror fallback path, but this does not certify each Wikimedia image works.
- The 91 URLs were inspected **read-only in the database**. External per-link HTTP status, image relevance, and public attribution **were not certified** here. The runtime doing the audit could not resolve external DNS, so no false claims about image-load success are made.

## Safe follow-up tasks
1. In isolated Chromium/browser QA, test all **91 exact, current URLs**, record HTTP outcome and image dimensions; do not alter live records.
2. For each image failure, replace only after confirming the correct item and permission/license; do not substitute meat/egg photographs for the Pure Veg restaurant.
3. Add a public photo-credits presentation or replace with restaurant-owned photographs, with licensing verified individually.
4. Before public paid launch, verify the 21 missing historical dish decisions, the 25 unavailable rows, and Choklet's intended visibility separately.

**No product image record or existing menu was modified.**
