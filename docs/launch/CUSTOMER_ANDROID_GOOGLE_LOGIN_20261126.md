# Bite Customer APK — Google Login via external browser and PKCE

Date: 26 November 2026. Source change is a **candidate**, not a live or signed APK release.

## Root cause

`customer.html` already renders the Google button on a **normal browser** only if `/auth/v1/settings` reports `external.google=true`. The old Capacitor Customer APK uses an Android WebView (UA contains `; wv`), and `isEmbeddedCustomerWebView()` deliberately hid Google login to avoid Google's embedded-user-agent OAuth prohibition. Merely removing `hidden` would cause an unsupported login.

The signed Android workflow builds native source from `feature/bite-android-apk`, and obtains approved patches from current main. The native code of an installed APK is **not upgraded by a website refresh**.

## Candidate implementation

- Existing website flow remains unchanged. New signed Customer APK registers `BiteGoogleOAuth` Java plugin and displays the Google button when provider readiness is verified.
- Android customer uses Supabase `flowType:'pkce'` with `skipBrowserRedirect:true`; the plugin validates Supabase's exact HTTPS authorize endpoint, Google provider, S256 code challenge and exact callback, then launches a Chrome Custom Tab (not WebView).
- Native `bitecustomer://oauth/callback?code=...` deep link is accepted only by the Customer app's manifest filter. The plugin retains a one-time code until the authenticated app WebView resumes, then JavaScript uses `sb.auth.exchangeCodeForSession(code)`. No access or refresh token is exposed to the native URL.
- The same `sb.auth` client resumes existing Customer identity, cart and checkout intent. Email/password sign-in remains available. Partner and Admin packages never receive the Customer OAuth bridge.
- The build workflow includes the approved native patch, verifies its generated manifest/plugin, and increments default APK versionCode to 19.

## External activation and acceptance gates — NOT VERIFIED

1. Google Cloud OAuth **Web application** client must exist with authorized redirect URL `https://wedbgpybbgsszcmffoha.supabase.co/auth/v1/callback`, valid consent setup and permitted test users as required. No client secret belongs in the APK.
2. In Supabase project `wedbgpybbgsszcmffoha`, **Authentication → Providers → Google** must be enabled and configured. Check the real public Auth `/auth/v1/settings` value `external.google=true`. Current connector does not expose the live provider configuration. This requirement has **not** been independently confirmed.
3. Under **Authentication → URL Configuration → Redirect URLs**, permit `bitecustomer://oauth/callback` exactly, and preserve the existing GitHub Pages Customer URL. Without this, Supabase may reject/replace the callback and native login cannot succeed. Do not widen allowlists to unrelated origins.
4. Run full GitHub exact-head/static/browser QA and an actual signed APK v19 Android build; install/upgrade the signed Customer APK. An old v18 APK will **not** gain the native bridge from website updates.
5. On an actual Android phone: verify Google button in **Login** and **Sign up**, Chrome Custom Tab Google account chooser, deep link into **Bite Customer** (not Owner), correct signed-in account, preserved cart, cancelled login, wrong Google account, offline/network error, logout and relogin. Verify no payment or checkout is triggered by login.
6. Verify redirected-login resistance: malformed/unrelated deep links denied, unauthenticated code rejected by PKCE, WebView never visits `accounts.google.com` OAuth login. Recheck provider error logs without printing OAuth codes or tokens.

Only after code QA + Google provider/redirect configuration + **real signed Android login acceptance** should this be declared LIVE/ACCEPTED. Do not alter payment refunds, restaurant tenant policies, or production customer records in this batch.

References:
- Google support: https://support.google.com/faqs/answer/12284343
- Supabase Google Auth: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- Android Custom Tabs: https://developer.android.com/develop/ui/views/layout/webapps/overview-of-android-custom-tabs
