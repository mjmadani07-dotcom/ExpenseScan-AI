# Security and data integrity

Status: design and audit findings; this is not a security certification.

## Release gates

- No API key or signing credential embedded in APK, JavaScript, Git, logs or backups. Store device credentials through Android Keystore-backed storage and require explicit user consent for external document transfer. Shared production provider keys stay on an authenticated gateway. Restrict endpoint hosts, validate HTTPS, redirect policy and DNS/network destination; never forward a secret to an unapproved arbitrary base URL.
- Local PIN/biometric app lock with retry throttling and automatic relock. App lock is not equivalent to encryption: evaluate SQLCipher/attachment encryption and recovery, enforce device-private storage, and disable unintentional Android cloud backup of sensitive files.
- Validate all create/update/import operations using one domain schema, reject unexpected fields, invalid dates/currencies, non-finite amounts and inappropriate negatives. Verify totals and tranches; use transactions and integrity checks.
- Do not reset corrupt data. Back up before destructive actions. Test restore on a different device, app upgrade and abrupt process termination. Use explicit confirmations and soft deletion/audit history.
- No silent write fallback, no false success, no loss of drafts on navigation, no automatic AI retry that could duplicate charges without explicit policy.
- Stable application ID and release signing identity; protect signing material with restricted CI secrets and an offline copy. Debug APK is not a production update path.

## Existing web risks (not fixed by phase 0)

Unauthenticated /api ledger and extraction routes; missing extraction rate limiting; raw JSON patch acceptance; corrupt ledger fallback to seed data; offline local-only writes overwritten by server reload; custom AI endpoint trust; public repo history and ephemeral hosting. Do not publish the legacy server before hardening it. Separate web work should implement real access controls, rate limits, safe storage and validated writes; a shared password is only a limited temporary mitigation. The original public repository contains tracked demo data; check history for any actual sensitive content, rotate exposed credentials if found. Ignoring a file does not remove it from Git history.

## Operational boundaries

Offline use does not require login to a remote service. Online provider reachability and CORS/native HTTP integration must be tested independently. Device-key mode cannot guarantee immunity to runtime compromise and must comply with provider terms. Do not store financial documents in public directories by default; export only at user request. Data loss on uninstall is possible without an external recoverable backup.

## Implemented phase 4 controls
Android native payload and API key map have distinct AES-GCM Keystore aliases; no plaintext fallback. Keys are not included in portable backup. Device key loss requires external encrypted backup; native schema 1 migration does not guarantee physical erasure of old pages. Portable backups use user password, random salt and IV, PBKDF2-SHA256 600k and authenticated encryption. One rotating internal recovery checkpoint (not independent backup) is retained. The app still has no PIN/biometric gate; credentials are accessible to running app JavaScript and direct provider calls; verify provider endpoint before use. Native hardware security/restore has not yet been device tested.

Release signing is owner-controlled through a dedicated protected environment and verified certificate fingerprint. See ANDROID_SIGNING.md. Do not treat GitHub debug signatures as a stable update identity.

Device credential gate is implemented in Java via Android KeyguardManager, not a JS-only overlay. Session timeout uses monotonic elapsed time, sensitive bridge methods check session, and UI unmounts on lock. FLAG_SECURE prevents ordinary screenshot/task preview capture. This is an app access gate, not a claim that the Keystore keys require per-use device authentication or that a compromised process is protected. No custom PIN/biometric prompt yet; device testing required. JSON/XLSX exports are not encrypted.

Internal recovery archive: three rotating checkpoints, each stored inside the encrypted ledger payload, manual creation and selective restore/delete. Logical deletion does not guarantee physical erasure. Capacity limit is shared with the ledger; exceeding it fails closed. No scheduled external backup or off-device synchronization is implemented.

Originals: distinct Keystore AES-GCM alias; SHA-256 verified on write/read; immutable atomic files. No file paths from user input. Explicit plaintext export warning. Backup contents include referenced originals and validate integrity before restore; failed writes can leave encrypted unreferenced files but cannot point committed ledger to unwritten bytes. No secure erase or orphan cleanup yet.
