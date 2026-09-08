# MR SCRAP — Personal Social Radar

MR SCRAP monitors selected Facebook/Instagram sources and alerts the user only when a post matches a natural-language watch rule.

> **Core promise:** Share once → Watch automatically → Get alerted only when something you care about happens.

## Current status

This repository is in **alpha / production-architecture implementation**. The current integration branch is:

`work/real-session-ai-provider`

The branch is intentionally kept behind Draft PR #1 until the physical Android acceptance flow and remaining production blockers are closed.

### What is real now

- React/Vite application UI.
- Capacitor Android project builds successfully in CI.
- Android Share Target receives shared text/URLs.
- Dedicated Facebook WebView login surface.
- Facebook WebView cookies remain local to Android's `CookieManager`.
- Android authenticated collector extracts normalized post metadata.
- WorkManager schedules best-effort background checks.
- Backend device ingestion requires a bearer credential; only its SHA-256 digest is stored server-side.
- Android stores its backend bearer credential with an AndroidKeyStore-backed AES-GCM store instead of WorkManager job data/localStorage.
- PostgreSQL persistence for sources, rules, posts, matches, notifications, connector events and devices.
- Deterministic, race-safe post/match deduplication.
- Provider-neutral AI architecture controlled by the application operator.
- Production mode does not silently fall back to fake posts/matches/local JSON persistence.
- CI typechecks, tests, bundles web/server, syncs Capacitor and compiles Android APK.

### Not production-ready yet

- Full end-user authentication and tenant isolation are not implemented; CRUD still uses `user_default`.
- Device registration is not yet bound to an authenticated user account.
- Real FCM/Web Push delivery is not finished.
- Facebook WebView login + collector still requires acceptance testing on physical Android hardware.
- Instagram authenticated-session behavior is not independently validated.
- Meta DOM changes can break local extraction and require maintenance.
- Play Store release signing, store metadata/privacy declarations and production release configuration remain outstanding.

See [`PRODUCTION_STATUS.md`](./PRODUCTION_STATUS.md) for the launch gate and [`docs/SECURITY.md`](./docs/SECURITY.md) for trust boundaries.

---

## Architecture

```text
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

Raw Facebook passwords and raw Facebook cookies are not part of the backend ingestion contract.

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

For Android builds, also compile in the public backend origin:

```env
VITE_API_BASE_URL=https://api.example.com
```

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

Every PR verification run compiles a debug APK and uploads it as a short-lived GitHub Actions artifact.

### Android Alpha Release

`.github/workflows/android-alpha-release.yml` can publish/update a mutable prerelease named:

`MR SCRAP Android Alpha`

Tag:

`android-alpha`

The release contains:

- `MR-SCRAP-android-alpha.apk`
- `MR-SCRAP-android-alpha.apk.sha256`
- `COMMIT_SHA.txt`

For automatic branch publishing, configure the GitHub repository variable:

`ALPHA_API_BASE_URL=https://your-real-backend.example`

The alpha release is intentionally a **debug build**, not a Play Store production release.

Release process: [`docs/RELEASES.md`](./docs/RELEASES.md).

---

## Monitoring behavior

Authenticated Android sources use WorkManager. Android controls scheduling; this is best-effort periodic monitoring, not guaranteed exact real-time delivery. The minimum current periodic interval is 15 minutes.

A future foreground-service mode can reduce latency but would require a persistent notification and higher battery usage.

---

## Security summary

- Facebook credentials are entered only into Facebook's real WebView page.
- Raw Facebook cookies do not leave the Android device.
- Backend device tokens are hashed server-side.
- Android stores its backend device token using AndroidKeyStore-backed AES-GCM encryption.
- App-data backup is disabled for the Android package.
- Production PostgreSQL failure is fatal; there is no silent JSON fallback.
- Production AI credentials stay server-side and remote AI endpoints require TLS.
- Internal AI health/probe routes are protected with `ADMIN_API_TOKEN` in production.
- The app does not claim to bypass CAPTCHA, access controls or platform restrictions.

Important: full user authentication/tenant isolation is still a P0 blocker before external production use.

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
