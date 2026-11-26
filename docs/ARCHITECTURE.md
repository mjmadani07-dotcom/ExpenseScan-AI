# Android architecture — ADR-001 (accepted design, not implementation)

Baseline: main at ad7561f5361bfa658bf9a55ccc8d0083b5522d61. Decision: keep React/TypeScript UI and finance logic, use Capacitor for a bundled Android app with native SQLite. Do not wrap the remotely hosted web app or embed Express/Node in the APK.

## Boundaries

- Shared domain: expense types, currency and historical exchange rates, installments, duplicate detection, budgets, Jalali dates, validation and exports. Pure TypeScript where possible; UI must not be the validation boundary.
- Application layer: async LedgerRepository, DraftRepository, AttachmentRepository, BackupService, CredentialStore and AiExtractionService. Errors are explicit; success only after durable commit. Use dependency injection at the app composition root.
- Android: SQLite transactions and migrations; app-private files for source documents; Keystore-backed encryption/key wrapping for credentials; native camera/file picker/share and lifecycle/back handling. No HTTP ledger API in Android mode.
- Web: preserve existing Express adapter until hardened; offline cache must be read-only unless a durable sync protocol exists. No silent local fallback writes.
- AI: manual capture/approval works without keys and network. Online extraction is an optional service, independent of local commits. Preferred production route is authenticated AI gateway with scoped credentials, limits and approved endpoints. User-provided device keys are a separate explicit-risk mode subject to provider rules; never bundle a shared secret.
- Native app ships HTML/CSS/JS/assets locally; no remote WebView navigation or development server in release. Disable PWA service worker for native build; retain PWA for web. Self-host fonts.

## Failure behavior

Persist drafts before navigating or backgrounding. Write record/line items/payment state and audit event in one transaction. No destructive reset on read/migration error, no demo data by default. Report failures and preserve original files. AI errors leave drafts recoverable. A retry never blindly creates duplicate approved records.

## Scope

Single device, single active ledger UI in v1, schema prepared for distinct ledgers. No automatic multi-device sync, multi-user permissions or approval workflow yet. Keep branch main untouched during development and merge platform-independent changes back after review. No long-lived divergent business logic.
