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
