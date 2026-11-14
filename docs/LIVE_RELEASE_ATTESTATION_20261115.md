# Bite — Public GitHub Pages release attestation (15 November 2026)

## Why this deployment gate exists
Bite's GitHub main branch, passing pull-request QA, and the live GitHub Pages site are **three different states**. A green PR test does not prove that the public customer or Owner website is serving the latest approved JavaScript. The current Pages workflow already checks that an exact main SHA passed the push-triggered Bite QA, but it did **not** read back the published site after deployment.

This feature adds a **read-only public release proof** after each GitHub Pages publish. It does not call Supabase Auth, Cashfree or any customer order endpoint, log in, collect card data, start payments, or mutate bank records.

## How it works
After the deployment action completes, `scripts/verify_live_pages.py` checks the production URL `https://gauravjoshi2999.github.io/restaurant-os/` against the **exact locally built** `dist/site` artifact from the GitHub-approved commit:

- `index.html` for Owner/Super Admin, with its `bite-deploy-sha` marker
- `customer.html` with its `bite-customer-build` marker
- `delivery.html`, `menu-qr.html`
- `assets/admin-cashfree-audit.js`, `assets/bite-pos-drafts.js`
- `bite-deploy-version.json`, exactly `{"sha": <approved 40-character SHA>}`

Every file must have HTTP 200 and byte-for-byte SHA-256 parity with the artifact. Probes use an immutable-commit query parameter to avoid stale CDN cache responses, retry a bounded eight times for GitHub Pages propagation, and fail the **deployment job** if live bytes still do not match. The post-deploy gate never exposes page contents, auth keys or financial details in logs.

`scripts/verify_live_pages_test.py` tests the algorithm offline: successful exact parity, stale JS, stale customer HTML, missing build marker, wrong SHA, malicious URL and oversized/missing files. It is run on every PR's Bite static QA.

## Scope limitations
- This is a **public static release check**, not an authenticated browser/payment/Android acceptance test.
- It proves the specified public files are correct **only at the time of the GitHub runner's check**; production runtime issues, Supabase role mapping, browser cache and full customer checkout are independently tested.
- Some visitors may hold older browser caches briefly even when the public CDN is up to date. The HTML entrypoints must continue to version JavaScript assets when changed.
- GitHub connector workflow-run retrieval may not expose all main push/deploy statuses; the authoritative pass/fail evidence is in the repository's GitHub Actions **Deploy RestaurantOS to GitHub Pages** run under the final **Verify the live public build matches the approved commit** step.

## Launch gate
Do not call a website revision **live** solely because its code was merged, the QA passed or Supabase Edge Functions were deployed. Require an exact live attestation for the main SHA and separate user-visible checkout, Owner, Android notification and Cashfree settlement acceptance. Any failed live attestation blocks declaring that release verified until investigated.
