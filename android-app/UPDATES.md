# Bite Android updates — release setup

This branch prepares three Android app variants: Customer (`in.bite.restaurant`), Partner (`in.bite.partner`) and Admin (`in.bite.admin`).

## Configure release signing (required once)

Create and safely back up a private Android release keystore. Never commit the keystore or passwords to Git. Add these GitHub Actions repository secrets:

- `BITE_ANDROID_KEYSTORE_BASE64`: base64 of the binary keystore, single line.
- `BITE_ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `BITE_ANDROID_KEY_ALIAS`: alias of the signing key.
- `BITE_ANDROID_KEY_PASSWORD`: key password.

Keep the same keystore for every future release and for all three app variants. Losing it prevents in-place upgrades of apps signed with it. Debug APKs currently installed may be signed with a different key and **cannot necessarily be upgraded in place**; users may need to uninstall the debug build once before installing the first signed release. Back up app data before uninstalling.

## Building

Run the `Bite Android debug APK` workflow on branch `feature/bite-android-apk` with a monotonically increasing `version_code`. The workflow produces debug APK artifacts; when secrets are configured, it additionally produces signed release APK artifacts and verifies their signatures. Verify the run before distributing artifacts.

## Automatic update notification — not yet enabled

This workflow does not yet publish signed APKs to a permanent public URL, produce a trusted update manifest, or display an in-app update prompt. These steps must be implemented and tested before claiming app-update functionality. Android requires user confirmation for sideloaded APK installation. Web content updates from the live site are separate and do not require APK updates.

For production, prefer Google Play In-App Updates (when distributed via Play), or signed releases with an authenticated HTTPS manifest and Android's install permission/user confirmation. Never automatically install unknown APKs or bypass Android security prompts.
