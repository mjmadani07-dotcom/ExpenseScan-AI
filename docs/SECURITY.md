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

Schema v3 row payloads retain AES-GCM encryption and authenticate row identity/table/parent inside the sealed envelope. SQLite identifiers, relationships and row counts are not encrypted; no plaintext amount/vendor columns. Migration is transactional and logical deletion does not ensure physical erasure. Real-device validation remains required.

Direct AI tests use only synthetic receipt text and the selected model; user confirms destination host. Android requests require HTTPS and reject redirects. Provider response bodies are not surfaced in errors. No live provider credentials or financial documents were used in CI. Test success does not establish vision capability or guarantee provider data privacy.

Biometric login uses the AndroidX system prompt with BIOMETRIC_STRONG, no custom fingerprint or face matching, and preserves a separate system credential login. This is an application session gate, not per-use biometric-bound encryption keys. Sensitive bridge logging is disabled via Capacitor loggingBehavior none; debug APKs remain test-only.

Orphan cleanup does not accept a client list of paths or IDs. It recomputes references from native decrypted rows with a matching revision and only deletes aged unreferenced private .enc files without sidecars. Native row writes and file cleanup are serialized, and newly referenced attachments must exist at commit. A referenced missing file blocks cleanup. User confirms irreversible logical deletion. No secure erase guarantee.

Streaming v2 backup encrypts the financial manifest and each original independently with authenticated sequence/length/header and a final authenticated terminator. Keys/config and internal recoveries excluded as in v1. A bad password, missing, reordered, corrupted or extra frame fails restore before ledger commit. Temporary export bytes are ciphertext in private cache; a failed restore can retain unreferenced encrypted originals. No plaintext temporary archive. Native copy failure can leave a partial ciphertext destination, which restore rejects. Do not treat compile/tests as a security audit.

Private original preview reads through the session-protected bridge, checks digest and MIME signature for PDF/images, displays text as escaped text and never navigates to document-supplied URLs. PDF uses local PDF.js worker and bounded canvas; no plaintext file output is required for viewing. Original explicit export remains plaintext and user-confirmed. Content exists in process memory while unlocked, not an assurance of secure memory erasure. This is not a full PDF sandbox security audit.

Approval replay does not reinsert deleted financial records or overwrite current values with stored approval snapshots. The last approval record is still retained for compatibility; replay uses current ledger identities and rejects missing or replaced identities. The UI reloads the authoritative ledger after approval. No claim of global duplicate detection.
