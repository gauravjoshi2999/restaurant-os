# Bite Android testing prototype

This is an **online-only Capacitor WebView wrapper** pointing to the existing Bite customer page. It is **not production ready**, not a native/offline build, and must not be submitted to Play Store as-is.

The build uses Node 22, Java 21, Android SDK and Capacitor 7. The CI workflow produces a debug APK for device testing. Real payment checkout, Cashfree SDK requirements, OAuth/password reset redirects, Android back navigation, privacy and WebView restrictions require verification and likely additional implementation before release. Do not use for real-money payment testing without safe test setup.

Workflow: Actions > Bite Android debug APK > Run workflow (on feature/bite-android-apk); download artifact after success.

Signed-release verification: the CI push build checks all three role-specific release APKs using the configured GitHub Actions signing secrets. Each signed artifact must be checked before installation; debug APKs are not in-place upgrades for release-signed APKs.
