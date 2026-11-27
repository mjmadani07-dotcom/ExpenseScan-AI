# Android signing and update policy

Do not use the ephemeral CI debug key for company deployment. Existing debug builds may have different signing identities and cannot be upgraded in-place to the signed beta. Export an encrypted portable backup before uninstalling any debug APK. Install the signed beta, then restore the file. The stable application ID remains ir.expensescan.hesabyar.

## One-time owner setup (not yet done)

1. On a trusted offline machine, generate a dedicated Android release keystore with keytool or Android Studio. Use a strong password, preserve two protected offline copies, and record the certificate SHA-256 fingerprint. Never commit the keystore or send it in chat.
2. In GitHub Settings → Environments, create `android-signing` with restricted reviewers and tag policy (android-beta-*), if supported. Add environment secrets ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD, ANDROID_KEY_ALIAS. Set environment variable ANDROID_CERT_SHA256 to the expected public fingerprint. Base64 is transport encoding, not encryption.
3. Before any release, review the exact commit and approve the release gates. Push an explicit tag `android-beta-100` (or a strictly larger integer for each subsequent beta). Do not reuse versionCode or tag. The workflow verifies the source is on android, the certificate matches, package ID and versionCode are correct and the APK is not debuggable. Artifacts expire in three days; archive approved APKs securely outside Actions.
4. Test updating from one signed beta to the next without uninstalling; verify data, backups, vault and migration. Never promote a debug build or an untested beta to operational use.

The workflow has not been run with real signing credentials. No key is created or stored by the assistant; this is deliberately an owner-controlled step. No automated public release is created.
