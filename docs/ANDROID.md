# Android implementation roadmap

Phase 0 initializes the branch and baseline. Current status: implementation starts here; APK generation and device acceptance remain future work. Track acceptance by evidence, not by documentation alone.

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0 | branch, architecture, baseline package/lock/scripts, ignore rules, CI checks | clean install, lint, tests, web build and production health smoke pass |
| 1 | domain validation, exact amounts, local date, seed separation | invalid data rejected, Jalali leap/boundary and currency/instalment regression tests pass |
| 2 | repository interfaces, SQLite, migrations, attachments/drafts and JSON import | offline CRUD survives relaunch; transactional failure leaves previous data intact; no Express dependency in native mode |
| 3 | Capacitor native Android shell, camera, document picker, sharing, lifecycle and back | install debug APK; launch airplane-mode; camera/PDF and permission denial handled |
| 4 | lock, credential storage, backups, restore, audit/soft deletion | recovery on second device; no leaked secrets; failed migration/restore preserves data |
| 5 | mobile UX, settings-only AI panel, condensed forms, draft persistence, numeric inputs | small-screen and RTL tests, hardware back, Persian digits, accessibility |
| 6 | lazy imports, local fonts, page/attachment limits and pagination | performance measured on representative device; offline font and large ledger work |
| 7 | signed release workflow, release notes and upgrades | repeatable APK build; same signer and application ID; monotonically increasing versionCode |
| 8 | device acceptance | clean install, offline/online workflows, interrupted saves, update with existing data and restore verified |

## Build and distribution policy

Use a dedicated Android CI workflow after native project exists. Test/lint/build on changes; avoid persistent test artifacts. Keep debug APK artifacts at 1–3 days only when useful, release APKs on explicit tags/releases. Do not delete published versions or signing material automatically. No production credentials in debug builds. Choose final application ID, supported Android API level, Capacitor/SQLite plugin versions and signing identity in phase 3 after verifying compatibility. Do not publish release until phase 8 gates pass.

## Current baseline

The external review reported passing type checking/tests/build; not independently reproduced at planning time. CI is intended to verify branch changes. The npm/esbuild conflict is evidenced by direct esbuild ^0.25 versus Vite peer ^0.27 or ^0.28; remove the unnecessary direct dependency and align lock to the existing tsx transitive resolution. The existing web server still contains known security/data issues and is for local development only. No native project or APK at phase 0.

## Phase 1 changes
Global display unit is independent of source currency; domestic amount inputs convert reversibly, foreign amount entry stays explicitly denominated in the original currency with equivalent display. Tehran business date is default; event timestamps stay UTC. Added shared validation for new/edited expenses, empty operational store and fail-closed legacy JSON read. Import validation and full durable offline storage still require further work. CI and device UX validation are required.

## Phase 2 — first storage milestone
The application now receives a LedgerRepository, with HTTP web and local SQLite implementations. Shared LedgerDomain is used by the existing server and the local repository. SQLite schema v1 intentionally stores a versioned ledger/draft snapshot in one row with compare-and-swap commits, atomic draft approval and explicit errors; Node SQLite integration tests exercise persistence and conflicts. The local repository is wired to draft restore/save/approval in App via dependency injection; the Android native driver, device validation of draft lifecycle, normalization into per-entity tables, encrypted attachments/backups, and device acceptance are still pending. No APK yet. The default entry point still uses web mode until a native driver is installed.
