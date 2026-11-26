# Customer APK Google login — native release gate

The existing R14/customer web OAuth stays intact. Customer Android uses Credential Manager's explicit Google account picker, a secure random nonce, SHA-256 nonce for Google, raw nonce for Supabase signInWithIdToken. Native plugin is restricted to package in.bite.restaurant and the exact HTTPS Customer route; old APK and unconfigured provider retain email login. No client secret is embedded or logged.

Before publishing:
1. Google Cloud OAuth: create/verify Web application client in Bite's project; enable Google provider in Supabase with the matching Web client ID and secret (secret ONLY in Supabase).
2. Create Android OAuth client for in.bite.restaurant with the actual stable release signing certificate SHA-1. Get fingerprint from the signed artifact using apksigner verify --print-certs; do not disclose signing credentials.
3. The signed build now discovers the existing public Web client ID from the exact live Supabase-to-Google authorization redirect, without following it, signing in or exchanging tokens. An optional repository Actions variable BITE_GOOGLE_WEB_CLIENT_ID must match this discovered ID; the signed Customer build fails closed if discovery/matching fails. No fake ID. The signed build also prints the public SHA-1 certificate digest in its summary for Android OAuth registration; never disclose the signing key.
4. Check the separate live Google provider preflight, Google OAuth audience, Supabase provider/audience settings and native compile QA. Build signed Customer APK with a version code higher than installed; automatic Customer candidate default 19, Partner/Admin 18. Verify package and existing signer.
5. Confirm exact Pages release includes matching JS. Install APK over existing app; test login and signup, account picker, cancellation, existing email fallback, logout/account switching, cart/restaurant restore, 320-430px and actual device. Never auto-start payment. No live acceptance from mocked tests.

Source references: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation and https://supabase.com/docs/guides/auth/social-sign-in/auth-google
