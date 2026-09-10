# MR SCRAP — Personal Social Radar

MR SCRAP monitors selected Facebook/Instagram sources and alerts the user only when a post matches a natural-language watch rule.

> **Core promise:** Share once → Watch automatically → Get alerted only when something you care about happens.

## Current status

This repository is in **alpha / production-architecture implementation**.

Current validation/evidence lane:

`test/android-headless-emulator-20260909` — Draft PR #7, validation-only, **DO NOT MERGE AS-IS**.

Protected provider/production lane:

`work/real-session-ai-provider` — Draft PR #1, `OWNER_BLOCKED` unless its Production/provider scope is explicitly reopened.

The software/CI validation tree is GREEN. The remaining P0 gate is the complete physical Android Facebook-session acceptance protocol on a real device. After that passes, create a clean promotion branch from the then-current `main`; do not merge PR #7 directly.

### What is real now

- React/Vite application UI.
- MR SCRAP application signup/login with email/password.
- Passwords hashed with scrypt and random salt.
- Opaque application sessions with hash-only server persistence and HttpOnly cookies.
- Tenant-isolated sources, rules, alerts, scans and device registration.
- Cross-tenant integration tests proving user B cannot access or mutate user A resources.
- Capacitor Android project and Android Share Target.
- Dedicated Facebook WebView login surface.
- Facebook WebView cookies remain local to Android's `CookieManager`.
- Android authenticated collector extracts normalized post metadata.
- WorkManager schedules best-effort background checks.
- Backend device ingestion uses a user-bound bearer credential; only its SHA-256 digest is stored server-side.
- Android stores the backend device bearer using AndroidKeyStore-backed AES-GCM.
- PostgreSQL persistence for users, app sessions, devices, sources, rules, posts, matches, notifications and connector events.
- Deterministic, race-safe source-scoped post/match deduplication.
- Provider-neutral AI architecture controlled by the application operator.
- Production mode does not silently fall back to fake posts/matches/local JSON persistence.
- Reproducible CI validation through committed `package-lock.json` + `npm ci`.
- Code Complete Gate typechecks, runs tests, bundles web/server, syncs Capacitor, compiles Android and uploads a debug APK artifact.

### Not production-ready yet

- Facebook WebView login + collector still requires acceptance testing on physical Android hardware.
- Real FCM/Web Push delivery is not finished; alerts are currently in-app only.
- Instagram authenticated-session behavior is not independently validated.
- Meta DOM changes can break local extraction and require maintenance.
- Email verification/password reset are not implemented yet.
- Play Store release signing, store metadata/privacy declarations and production release configuration remain outstanding.
- Production distributed rate limiting/observability is still follow-up work before horizontal scale.

See [`PRODUCTION_STATUS.md`](./PRODUCTION_STATUS.md) for the launch gate and [`docs/SECURITY.md`](./docs/SECURITY.md) for trust boundaries.

---

## Architecture

```text
MR SCRAP account
        │
        │ authenticated application session
        ▼
Tenant-scoped backend APIs
        │
        ├─ user-bound Android device credential
        │
        ▼
Facebook / Instagram
        │
        │ user-authenticated WebView session (Android only)
        ▼
AuthenticatedWebCollector
        │
        │ normalized post metadata only
        ▼
MR SCRAP Backend
        │
        ├─ PostgreSQL persistence
        ├─ deterministic dedupe
        ├─ rule selection
        ▼
Operator-configured AI Provider
        │
        ▼
Match
        │
        ├─ in-app notification record
        └─ future FCM/Web Push delivery
```

The MR SCRAP application session, MR SCRAP backend device bearer and Facebook WebView session are three separate credential boundaries. Raw Facebook passwords and raw Facebook cookies are not part of the backend ingestion contract.

Detailed design: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## AI provider configuration

The AI provider is configured centrally by the application operator. End users do not enter API keys or choose models.

```env
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=...
AI_MODEL=...
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI
```

Supported `AI_API_FORMAT` values:

- `openai_chat`
- `openai_responses`
- `gemini_native`

Remote AI endpoints must use HTTPS in production.

---

## Required production environment

```env
APP_MODE=production
DATABASE_URL=postgresql://...

AI_BASE_URL=https://...
AI_API_KEY=...
AI_MODEL=...
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI

APP_URL=https://app.example.com
CORS_ALLOWED_ORIGINS=
ADMIN_API_TOKEN=<long-random-operator-secret>
```

For Android builds, compile in the public backend origin:

```env
VITE_API_BASE_URL=https://api.example.com
```

The production Capacitor topology uses an HttpOnly Secure application-session cookie between the bundled `https://localhost` origin and the explicitly allowed hosted HTTPS API origin.

See [`.env.example`](./.env.example).

---

## Local development

Install the exact locked dependency graph:

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm test
npm run build
```

Or:

```bash
npm run verify
```

If dependency manifests are intentionally changed, update and review `package-lock.json` in the same change rather than relying on an uncommitted local graph.

Development/demo mode may use:

```env
APP_MODE=demo
```

Demo data must remain isolated from production execution paths.

---

## Android

Build/sync:

```bash
npm run android:sync
npm run android:open
```

Debug APK:

```bash
npm run android:build:debug
```

The Android build must have a real HTTPS `VITE_API_BASE_URL` for end-to-end testing.

Physical-device test checklist: [`docs/ANDROID_ACCEPTANCE_TEST.md`](./docs/ANDROID_ACCEPTANCE_TEST.md).

The physical acceptance update path is intentionally non-destructive: when a compatible app is already installed, verify signing compatibility and use `adb install -r`; do not uninstall or clear app/WebView/session data merely to update the candidate.

---

## APKs and releases

### Validation artifact

`.github/workflows/code-complete-gate.yml` builds a short-lived debug APK artifact on the isolated validation branch after locked dependency install, tests and build checks pass.

The generic hosted `.github/workflows/verify-real-session.yml` remains available for manual/general verification, but its automatic PR job is intentionally skipped on the validation lane and protected provider lane to avoid duplicate/failing hosted-runner noise.

A CI APK compiled with `https://example.invalid` proves build integrity only; it is not physical/backend acceptance evidence.

### Android Alpha Release

`.github/workflows/android-alpha-release.yml` is a separate controlled alpha-distribution path. It is outside the current PR #7 validation authority and is not a Play Store production-signing workflow.

Mutable prerelease name/tag when that lane is explicitly used:

```text
MR SCRAP Android Alpha
android-alpha
```

Release process: [`docs/RELEASES.md`](./docs/RELEASES.md).

---

## Monitoring behavior

Authenticated Android sources use WorkManager. Android controls scheduling; this is best-effort periodic monitoring, not guaranteed exact real-time delivery. The minimum current periodic interval is 15 minutes.

A future foreground-service mode could reduce latency but would require a persistent notification and higher battery usage.

---

## Security summary

- MR SCRAP application passwords are scrypt-hashed; plaintext passwords are not persisted.
- Application sessions use opaque random tokens with hash-only server persistence and HttpOnly cookies.
- Private CRUD is tenant-scoped and cross-tenant negative tests are part of CI.
- Android backend device credentials are bound to the authenticated MR SCRAP user.
- Facebook credentials are entered only into Facebook's real WebView page.
- Raw Facebook cookies do not leave the Android device by contract; physical network/log validation remains part of P0 acceptance.
- Backend device tokens are hashed server-side.
- Android stores its backend device token using AndroidKeyStore-backed AES-GCM encryption.
- App-data backup is disabled for the Android package.
- Production PostgreSQL failure is fatal; there is no silent JSON fallback.
- Production AI credentials stay server-side and remote AI endpoints require TLS.
- Internal AI health/probe routes are protected with `ADMIN_API_TOKEN` in production.
- The app does not claim to bypass CAPTCHA, access controls or platform restrictions.

The remaining P0 gate is physical Android acceptance of the application-session, Facebook WebView and live collector flows.

---

## Documentation

- [`PRODUCTION_STATUS.md`](./PRODUCTION_STATUS.md) — current launch gate and blockers
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture and data flow
- [`docs/SECURITY.md`](./docs/SECURITY.md) — security/trust boundaries and known risks
- [`docs/ANDROID_ACCEPTANCE_TEST.md`](./docs/ANDROID_ACCEPTANCE_TEST.md) — physical-device test protocol
- [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) — deployment/runtime checks
- [`docs/RELEASES.md`](./docs/RELEASES.md) — APK/release process

---

## Product rule

Production code must prefer an honest empty/error state over fabricated activity.

No production path may silently invent:

- source metadata
- posts
- matches
- connector health
- notification delivery
- AI success
