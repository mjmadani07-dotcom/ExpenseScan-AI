# ExpenseScan AI | حساب‌یار

Intelligent Persian RTL expense tracking and document extraction. This branch (`android`) prepares an independent Android application; it is **not yet an installable APK or production-ready financial system**. The web/PWA branch is `main`.

## Development baseline

Use Node.js 22.12+ (prefer Node 24 LTS for CI) and Bun with support for the committed text lockfile.

```sh
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run dev
```

To smoke-test the existing web server after building: `npm start`. It sets production mode before loading the TypeScript server. The server is legacy development infrastructure: do not expose it to the Internet or enter real company data until its security issues are addressed. Do not deploy the JSON store to ephemeral hosting.

The committed lockfile is the Bun lockfile; do not mix package managers or commit a second lockfile without an intentional migration. `npm run check` also runs type checking, tests, and build after dependencies are installed.

## Android plan

- [Architecture](docs/ARCHITECTURE.md)
- [Android roadmap and acceptance gates](docs/ANDROID.md)
- [Data model and migration](docs/DATA_MODEL.md)
- [Security and threat model](docs/SECURITY.md)

The first release will be local-first, with offline manual expense tracking and optional online AI. Keep API keys, real ledgers, backups and signing credentials outside Git. No APK exists yet.
