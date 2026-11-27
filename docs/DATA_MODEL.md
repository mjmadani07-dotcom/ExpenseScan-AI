# Proposed local data model and migration (phase 2)

SQLite is the authoritative Android store, not localStorage. Tables below are proposed, not yet created.

| Entity | Purpose / constraints |
| --- | --- |
| ledgers | UUID, display name, created_at, active ledger; initially one empty ledger |
| expenses | UUID, ledger_id FK, title, vendor, document type, category_id, cost center, currency, exact monetary amount, historical FX rate, document_date, purchaser, payment status, timestamps, soft-delete marker |
| categories | ledger-scoped ID, label, color, description, default flag; reassign before deletion |
| budgets | ledger_id, category_id, monthly limit in toman; unique per category per ledger |
| exchange_rates | ledger_id, currency, rate; document FX rate remains historical |
| line_items | expense_id FK, order, description, quantity, unit price, total |
| payment_tranches | expense_id FK, amount, method, status, due/payment date, reference, notes |
| drafts | ledger_id, input/source references, extracted fields, review state, timestamps |
| attachments | ledger_id, optional draft/expense FK, private relative path, MIME, size, content hash |
| audit_events | ledger_id, entity ID, action, UTC timestamp, minimal change metadata |
| app_settings | non-secret configuration, schema metadata; secrets outside DB |

Use foreign keys, unique constraints and indexes on ledger/date/category/payment status. Represent money precisely with integer minor units or a documented exact decimal policy; preserve IRR/IRT conversion, foreign-currency decimals, historical exchange rates and installment reconciliation. Do not round silently or change existing domain semantics without tests. Define a schema version and atomic upgrade transactions. Store calendar dates as YYYY-MM-DD using local/business timezone (default proposed Asia/Tehran, configurable later); UTC timestamps for events.

## Import / export

1. Read existing JSON exports through versioned validation, with dry-run counts/errors and explicit merge or replace selection. Reject malformed records without partial writes; never silently drop unknown currencies or fields.
2. Preserve IDs, amounts, currency, dates, rates, budgets, custom categories, payment tranches and purchaser. Resolve conflicts deterministically; detect duplicates without merging distinct documents automatically. Missing or legacy fields require explicit migration rules.
3. Back up before replace or schema change; import within a transaction. Attachment files need separate staged writes and integrity checks; never trust absolute paths or path traversal.
4. Backups include versioned metadata, data and attachments; exclude keys by default. Restore preview, checksum, atomic replacement and recovery on interruption. Portable encrypted backup with user-held recovery secret where required.
5. Keep sample fixtures separate; start operational ledger empty. The baseline data/ledger.json had 11 seed-ID expenses and is removed from tracking on android only; original remains in main/history. Export any existing deployed ledger before upgrading. Existing web storage and its seed initialization are still legacy, to be changed in later phases.

## Phase 2 implementation note
Schema v1 is a transitional transactional snapshot (`ledger_state`, revision and payload). This keeps existing financial fields intact and prevents partial approval writes. Normalized indexed tables, separate attachment storage, encrypted backups, and migration from v1 remain release gates. The Node test driver is not shipped in Android; the native driver must implement the same SQL transaction and change-count contract.

Attachment references: optional attachmentId (SHA-256 lowercase hex) and attachmentMime on expense/draft; original immutable bytes reside outside the snapshot. Portable backup includes a map keyed by digest. Native original file limit 12 MiB; backup aggregate remains bounded. Normalization of ledger data and streaming archives remain pending.

## Implemented native schema v3: encrypted entity rows
The Android store now partitions the validated domain into `ledger_meta`, `ledger_categories`, `ledger_budgets`, `ledger_rates`, `ledger_expenses`, `ledger_line_items`, `ledger_payment_tranches`, `ledger_drafts`, `ledger_recoveries`, `ledger_approval` and `ledger_revision`. Child rows reference expenses via indexed foreign keys. Payloads remain encrypted JSON per entity (not plaintext SQL finance columns); envelope binds table, row ID and parent. The encrypted manifest preserves ordering and presence of all entities. Row diffs update only changed rows in a revision-checked transaction. Legacy v1 first migrates to encrypted v2; v2 is validated and round-tripped in TypeScript, then copied into v3 and legacy table dropped within one SQLite transaction. Recovery checkpoints retain their own snapshot payloads and do not change on ordinary expense edits. The current bridge still reads/reconstructs all rows in memory, and recovery checkpoints and portable export remain bounded; indexed date/category queries, streaming backup and multi-ledger remain future work. Node SQLite snapshot tests and native bridge contract/row codec tests are not Android device migration tests.

Before removing the legacy table, native migration now reads back and checks every stored encrypted row against the expected migration rows within the transaction. A read-only attachment inventory accounts for references in live ledger, drafts, all retained recovery checkpoints and approval replay records. It reports missing and unreferenced files, without deleting bytes.
