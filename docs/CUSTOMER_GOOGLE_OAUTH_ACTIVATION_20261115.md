# Bite Customer Google Login — Production Activation
Date: 2026-11-15

## What is implemented
- The **Customer** login/sign-up modal supports **Continue with Google** using Supabase Auth `signInWithOAuth({provider:'google'})`.
- The Google button appears in both Login and Sign up **only after the public Supabase Auth settings endpoint reports `external.google: true`**.
- The existing email/password and email-only password reset remain available.
- The callback points to the **same Customer page** and keeps restaurant-direct query parameters intact. Google sign-in does **not** place an order or auto-start payment.
- The button is not offered in Android embedded WebView, where Google OAuth's embedded-user-agent restriction makes this flow unreliable. Chrome-browser login works after setup; a native APK external-browser/deep-link solution needs separate device QA.
- No Owner, Admin, or Super Admin entry points, roles, restaurant access policies, or live payment logic are changed.

## Owner-only configuration — NOT performed by a frontend commit
**Important:** Until you finish this setup, the button stays hidden, so users never see a dead Google login option.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and select/create the Google Cloud project for Bite.
2. Set **Branding** to Bite / Eat. Repeat., contact/support email and your applicable privacy/terms URLs. Configure **Audience** as External and publish to Production when ready; Testing status restricts to listed test users.
3. Create an OAuth **Web application** client at [Google Auth Platform > Clients](https://console.cloud.google.com/auth/clients).
4. Set **Authorized JavaScript origins** to:
   `https://gauravjoshi2999.github.io`
5. Set **Authorized redirect URI** to the Supabase Auth callback:
   `https://wedbgpybbgsszcmffoha.supabase.co/auth/v1/callback`
   (Use the callback URL shown in the project's Supabase Google provider settings, if it differs.)
6. Open [Supabase Auth > Google provider](https://supabase.com/dashboard/project/wedbgpybbgsszcmffoha/auth/providers) and turn on Google. Paste the generated Client ID and **Client Secret into the Supabase dashboard only**. Never paste the Client Secret into GitHub, the frontend, or chat.
7. Open [Supabase Auth > URL Configuration](https://supabase.com/dashboard/project/wedbgpybbgsszcmffoha/auth/url-configuration) and allow the Customer callback:
   `https://gauravjoshi2999.github.io/restaurant-os/customer.html`
   For direct restaurant QR links that include query parameters, use a tightly scoped allow-list pattern for the same exact page, for example `https://gauravjoshi2999.github.io/restaurant-os/customer.html**`, and review it against Supabase's current redirect-pattern documentation. Do **not** allow unrestricted arbitrary domains.
8. Refresh the [Bite Customer site](https://gauravjoshi2999.github.io/restaurant-os/customer.html). The Google button will be visible once settings report the provider is on.

## Acceptance checks on a real phone
- In Chrome (not the Bite WebView APK), open Customer page, tap Login; Google button should appear, and Google account selection should complete and return to the same Customer page.
- Logout, use **Sign up > Continue with Google**, and verify no password or mobile OTP is required.
- Confirm a **customer-only** profile with the same Supabase Auth user ID and own Orders/Addresses; no owner/admin access. Also verify an existing email/password user can still log in and no old customer's data appears after logout/account switching.
- Try a direct restaurant page and ensure the same restaurant/menu is restored after the OAuth callback.
- Cancel Google sign-in, use email/password, and verify you can still log in.
- Test on Android Chrome and another mainstream mobile browser. The APK needs its own separate native browser handoff test.
- Confirm that the Google app is published for the target audience, not restricted to Google Cloud test users.
- Do **not** certify Google sign-in as live until the provider credentials, redirect list, and a real OAuth callback are verified.

## References
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/reference/javascript/auth-signinwithoauth
