# MR SCRAP — Personal Social Radar

MR SCRAP monitors selected Facebook/Instagram sources and alerts the user only when a post matches a natural-language watch rule.

> **Core promise:** Share once → Watch automatically → Get alerted only when something you care about happens.

## Current status

This repository is in **alpha / production-architecture implementation**. The current `main` branch contains the hardened web/API/Android architecture. Physical Android Facebook-session acceptance and the final launch gates remain explicitly open.

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
- The verification workflow typechecks, runs unit/integration tests, bundles web/server, syncs Capacitor, and is configured to compile an Android APK when GitHub-hosted runners are available.

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

```bash
npm install
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

---

## APKs and releases

### CI artifact

Every PR verification run compiles a debug APK and uploads it as a short-lived GitHub Actions artifact when the workflow is green.

### Android Alpha Release

`.github/workflows/android-alpha-release.yml` can publish/update a mutable prerelease named:

`MR SCRAP Android Alpha`

Tag:

`android-alpha`

The release contains:

- `MR-SCRAP-android-alpha.apk`
- `MR-SCRAP-android-alpha.apk.sha256`
- `COMMIT_SHA.txt`

For automatic branch publishing, configure:

`ALPHA_API_BASE_URL=https://your-real-backend.example`

The alpha release is intentionally a **debug build**, not a Play Store production release.

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
- Raw Facebook cookies do not leave the Android device.
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
