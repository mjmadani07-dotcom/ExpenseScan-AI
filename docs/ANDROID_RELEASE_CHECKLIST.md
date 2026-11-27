# Android beta release candidate gate

Status: pre-beta hardening. Do not tag or deploy until evidence is recorded.

## Automated gate (exact commit on android)

- [ ] Android baseline checks: type checking, financial/storage/security regression suite, web bundle and startup.
- [ ] Android experimental APK: Android build and native JVM regressions, package/signature inspection.
- [ ] Android emulator smoke: installed offline lock screen, actual Android SQLite migration/rollback, disposable AndroidKeyStore test and reopen.
- [ ] Review exact source commit; do not treat a successful compile as a device or security audit.

The signed workflow queries successful runs on the android branch for the exact tag commit. If any gate is missing, release fails before signing. Touch/update this checklist in the release-candidate commit to trigger both APK and emulator checks; this avoids running emulator tests on every small change. Baseline checks must also run on that commit. Do not tag an older candidate or reuse a versionCode.

## Physical-device acceptance (manual, not represented by CI)

Use a separate test phone and synthetic expenses. Record phone model, Android version, APK SHA-256, signer fingerprint, exact commit and results.

- [ ] Fresh install, secure screen lock, cancellation, PIN/pattern/password and supported strong biometrics.
- [ ] Airplane-mode manual entry, date and display unit consistency, edits and deletion; verify balances and filter/export totals.
- [ ] Receipt capture, PDF/image/text originals, multi-page viewer and Persian layout; no plaintext export for internal viewing.
- [ ] Process kill/reopen, device restart, idle/background lock, interruption during draft approval and no duplicate registration.
- [ ] Encrypted v1 and v2 restore; wrong password, truncated archive, cancel, insufficient storage and 36 MiB+ real attachment set; compare record IDs, amounts, currency, dates, payments and SHA-256 originals.
- [ ] Three recovery checkpoints and cleanup: protect live, draft, recovery and replay references; orphan age grace; missing-file refusal.
- [ ] Large ledger performance and repeated document viewing; record startup, scrolling, approval latency and memory, avoid invented thresholds.
- [ ] Stable signed beta install and in-place update with a strictly higher versionCode; confirm ledger, originals and key vault retained. Debug-to-beta requires verified backup and restore, not uninstall-first.
- [ ] Owner accepts risks and stores release APK/checksum and signing key backups securely.

Do not deploy a failed or untested candidate to operational accounts. No production data or signing secrets in logs or Git.

Candidate CI correction: explicit AVD home and startup preflight; corrected signature workflow formatting. All checkboxes remain unverified until the exact commit passes.

Security hardening candidate: fail closed on missing stored record IDs/timestamps, invalid draft structure/duplicate draft IDs/nonlocal preview URLs; incomplete manual drafts remain allowed. Dispose local repository at lock to block queued/in-flight mutations before commit; suppress late capture results; native explicit lock invalidates pending authentication result. In-progress native commits may finish atomically before lock acknowledgement. Verify exact candidate CI and manual device acceptance before tag.

End-to-end extension: disposable Android 35 emulator uses a synthetic system PIN and actual WebView UI, native bridge and SQLite. Scenario covers manual entry with a synthetic original, internal viewer, edit, SAF encrypted export, delete, wrong-password rejection, correct restore, lock/read refusal and Activity recreation. Restore/capture file input uses synthetic DataTransfer injection (not the OS file picker); confirmation and export use Android UI. No production authentication bypass or production fixture data. Results pending on exact candidate.

E2E retry correction: initial PIN test expected EditText, but Android may show a custom system PIN keypad. Verify resumed system credential activity and use actual keypad or digit key events; capture hierarchy and focused activity on failure. Compile app/test APKs before taking the emulator offline, with one bounded dependency retry, not assertion retry. Test refuses physical devices. This is a test/CI change only; no native authentication bypass or production data. Exact-commit verification still required.

Device feedback fixes: native system-bar/cutout/IME insets at the content root, collapsible settings with web-only PWA instructions, offline A4-landscape PDF report from filtered ledger/dashboard. Native PDF uses Android text layout for Persian, repeating headers, summary and pagination; plaintext export explicit. Physical-device layout and PDF typography still require visual acceptance.

Android 10+ export regression: verify actual published PDF in Downloads/HesabYar (nonempty, PDF header, PdfRenderer readable), return to the ledger without an external destination picker, export encrypted backup directly to the same folder, restore exact document and attachment. MediaStore pending files are only published after size and SHA-256 readback verification. Legacy Android retains SAF path. All exports must still pass exact-commit CI and physical-device acceptance.

Upgrade regression: after the offline invoice/PDF/backup/restore scenario, reassemble the same source with versionCode 2 instead of 1 on the same CI runner, verify identical APK certificate SHA-256, install with adb install -r, and authenticate again to verify the exact record ID, amount, currency, original attachment ID and readable contents. Synthetic test only; it isolates package update behavior, not schema changes between different source revisions or owner-signed APK acceptance. No uninstall or data clearing in the upgrade step.
