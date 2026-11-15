# Bite — live guest browser acceptance

Date: 2026-11-15

## Goal

The SHA-256 GitHub Pages release attestation now proves that the published site has exactly the approved static bytes. This release gate goes a step further by opening **the actual deployed website** in Chromium at mobile and desktop widths and exercising the public Customer journey and signed-out Owner login.

The launch blocker this closes: "Is the public Customer/Owner website actually usable and connected to real, publicly accessible restaurant and menu data after release?" It does **not** validate authenticated payment, restaurant-bank settlement, native Android lock-screen receipt, or Super Admin role mapping.

## Read-only scenarios

- Customer: HTTP 200, Bite branding, no repeated PIN/language control, live public restaurant list nonempty, working location picker (no PIN persisted), opening a restaurant menu from real Supabase public data, menu-search input and return-to-discovery.
- Owner workspace: HTTP 200, visible login, credentials fields, and an inaccessible private dashboard when signed out.
- Run at mobile 390px and desktop 1280px. Browser errors and public data failures fail the deployment job.
- The browser blocks **all** authenticated/auth/checkout/financial POSTs, all writes, and Cashfree API calls. Explicitly allows only three preexisting **public-read-only** Supabase RPCs: `bite_storefront`, `list_public_restaurants`, and `check_restaurant_delivery_area`. No test order, payment, refund, new account, OTP or delivery token is created.

## Workflow

After the exact live SHA/file-hash check, GitHub Pages deployment runs Chromium guest acceptance. The deployment job is considered successful only if **both** the static file parity and public guest-browser journey pass. An offline Python test guards the test's RPC allowlist and fails if a developer unintentionally broadens this to mutation endpoints.

Limitations: public, logged-out checks only; mobile phone FCM delivery and authenticated Cashfree checkout still require separate real-world acceptance.

For proof of completion, review the *latest main SHA* GitHub Actions **Deploy RestaurantOS to GitHub Pages** job's green **Verify live Customer and Owner guest browser flows** step. Do not infer that test passed just because the code was merged.
