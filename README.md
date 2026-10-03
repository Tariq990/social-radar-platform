# Social Radar Platform

**MR SCRAP** is a full-stack social monitoring application for watching selected Facebook and Instagram sources and evaluating new content against natural-language rules.

The repository combines a React product UI, an Express/PostgreSQL backend, tenant-scoped authentication, provider-neutral AI evaluation, and a Capacitor Android client that keeps authenticated social-session state on the device.

> **Current status:** alpha / production-architecture implementation. The software has substantial automated coverage and a real web/API/Android architecture, but physical-device social-session acceptance and several launch gates remain intentionally open.

## What this project demonstrates

- End-to-end TypeScript application development across browser, backend, database, and Android layers.
- React/Vite product UI backed by a real Express API.
- PostgreSQL persistence with tenant-aware ownership constraints and deduplication.
- Application authentication using scrypt password hashing and opaque server sessions.
- Cross-tenant authorization tests for private CRUD and device-ingestion boundaries.
- A separate Android device credential with hash-only server persistence.
- AndroidKeyStore-backed protection for the device bearer on-device.
- Capacitor Android integration, share targets, WebView session handling, and WorkManager background jobs.
- Provider-neutral AI adapters instead of hard-wiring business logic to one model vendor.
- Production fail-closed behavior when required database or AI dependencies are missing.
- Explicit security/trust-boundary documentation and launch-readiness tracking.

## Stack

| Layer | Technology |
|---|---|
| Web UI | React 19, Vite, TypeScript, Tailwind CSS |
| Backend | Node.js 22, Express, TypeScript |
| Database | PostgreSQL (`pg`) |
| Mobile | Capacitor 8, Android, Java 21, WorkManager |
| Authentication | scrypt passwords, opaque sessions, HttpOnly cookies |
| AI integration | OpenAI-compatible Chat, Responses API, Gemini-native adapter |
| Build | TypeScript, Vite, esbuild |
| Testing | Node test runner via `tsx --test` |

## Product flow

```text
User account
    |
    v
Tenant-scoped web/API session
    |
    +--> sources
    +--> natural-language rules
    +--> alerts
    +--> device registration
            |
            v
      Android device
            |
            +--> Facebook/Instagram WebView session stays local
            +--> AuthenticatedWebCollector
            +--> normalized post metadata
            |
            v
      HTTPS /api/device/ingest
            |
            v
      Express backend
            |
            +--> tenant/source authorization
            +--> validation + sanitization
            +--> PostgreSQL persistence
            +--> deterministic deduplication
            +--> AI rule evaluation
            +--> durable match/notification records
```

The application session, Android backend credential, and Facebook WebView session are deliberately separate trust boundaries. Raw Facebook passwords and raw social cookies are not part of the backend ingestion contract.

## Architecture highlights

### Tenant isolation

Private resources are scoped to the authenticated application user. Automated integration coverage exercises negative cases such as one user attempting to list, mutate, bind rules to, or ingest into another user's resources.

### Application authentication

The backend implements:

- normalized email/password registration and login;
- scrypt password hashing with random salt;
- opaque random application-session tokens;
- SHA-256 session-token hashes in PostgreSQL;
- HttpOnly session cookies;
- explicit credentialed CORS rules;
- logout/session revocation.

### Device authentication

Android background ingestion uses a credential distinct from the application cookie and the Facebook session:

1. an authenticated application user registers a device;
2. the backend generates an opaque device bearer;
3. only the SHA-256 token digest is stored server-side;
4. the device row is bound to the authenticated `user_id`;
5. Android stores the bearer under AndroidKeyStore-backed AES-GCM;
6. `/api/device/ingest` derives tenant identity from the validated device credential.

### Social-session boundary

For authenticated Facebook monitoring, the social session stays inside the Android WebView/CookieManager boundary. The collector sends normalized post/source metadata to the backend rather than exporting raw session credentials.

The project does not claim to bypass CAPTCHA, access controls, anti-bot systems, or platform restrictions.

### Provider-neutral AI

Business logic talks to an internal AI provider abstraction rather than a vendor-specific SDK. Supported formats are:

- `openai_chat`
- `openai_responses`
- `gemini_native`

Example operator configuration:

```env
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=...
AI_MODEL=...
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI
```

Remote AI endpoints must use HTTPS in production. Provider failure does not become a fabricated successful match.

## Persistence model

The PostgreSQL implementation includes application entities such as:

- users
- app sessions
- devices
- sources
- rules and rule-source bindings
- posts
- matches
- notifications
- connector events

Important integrity rules include case-insensitive unique application email, unique token hashes, user-scoped source identity, source-scoped post fingerprints, and unique rule/post matches.

## Deduplication

Post identity is resolved in this order:

1. external platform post ID;
2. canonical social post URL;
3. normalized content hash fallback.

The persisted fingerprint is source-scoped so identical public content monitored by different users/sources cannot suppress another tenant's processing.

## Repository map

```text
src/                         React/Vite application
server.ts                    HTTP/API entry point
server/
  auth/                      app and device authentication
  db/                        PostgreSQL persistence
  worker/                    ingestion and monitoring workers
  tests/                     backend/integration regression tests
android/                     Capacitor Android application
  app/src/main/              native activities, stores, collectors, workers
docs/
  ARCHITECTURE.md            detailed system design
  SECURITY.md                trust boundaries and known risks
  ANDROID_ACCEPTANCE_TEST.md physical-device protocol
  OPERATIONS.md              runtime/deployment checks
  RELEASES.md                Android release process
PRODUCTION_STATUS.md         authoritative launch-gate status
```

## Local development

Requirements:

- Node.js 22
- PostgreSQL for production-mode persistence paths
- Android Studio / Java 21 only when building the Android project

Install and run:

```bash
npm install
npm run dev
```

Use `.env.example` as the configuration reference.

### Production-mode essentials

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

For Android builds, the public backend origin is compiled through:

```env
VITE_API_BASE_URL=https://api.example.com
```

## Verification

```bash
npm run lint
npm test
npm run build
```

`npm run build` performs TypeScript validation, runs the server test suite, builds the Vite frontend, and bundles the Node server.

The current verified local state includes:

- 46/46 automated tests passing;
- TypeScript validation passing;
- Vite production build passing;
- Node server bundle passing;
- production dependency audit reporting zero known vulnerabilities at the time of verification.

Hosted GitHub Actions definitions are present, but account-level runner startup availability is external to this codebase; local test/build results are the current implementation verification source.

## Android

Sync/build the Capacitor project:

```bash
npm run android:sync
npm run android:open
```

Debug APK path:

```bash
npm run android:build:debug
```

The Android end-to-end flow requires a real HTTPS `VITE_API_BASE_URL` and physical-device testing for WebView/session behavior.

See [`docs/ANDROID_ACCEPTANCE_TEST.md`](./docs/ANDROID_ACCEPTANCE_TEST.md).

## Current implementation status

### Implemented and tested in code

- React/Vite product UI.
- Email/password application authentication.
- Tenant-scoped API authorization.
- User-bound Android device authentication.
- Logout/revocation paths.
- PostgreSQL production persistence.
- Source/rule/alert CRUD.
- Source-scoped post and match deduplication.
- Provider-neutral AI evaluation.
- Capacitor Android project and share target.
- Dedicated Facebook WebView login surface.
- Android local authenticated collector.
- WorkManager periodic monitoring path.
- In-app notification persistence.

### Explicitly not claimed as complete

- physical Android Facebook-session acceptance;
- independently validated Instagram authenticated-session behavior;
- real FCM/Web Push delivery;
- email verification and password recovery;
- Play Store production signing/release;
- distributed rate limiting/observability for horizontal scale.

The authoritative launch checklist is [`PRODUCTION_STATUS.md`](./PRODUCTION_STATUS.md).

## Security model

Key design rules:

- plaintext application passwords are not persisted;
- server application/device tokens are stored by digest rather than plaintext;
- social credentials/cookies stay device-local;
- production PostgreSQL failure is fatal instead of silently falling back to local JSON;
- production AI credentials are server-only;
- remote AI providers require TLS;
- internal AI probe endpoints require operator authorization in production;
- production code prefers an honest unavailable/empty state over fabricated activity.

For the detailed threat/trust-boundary discussion, see [`docs/SECURITY.md`](./docs/SECURITY.md).

## Known platform risk

Authenticated social collection is inherently sensitive to platform behavior. Facebook/Instagram can change login policies, WebView behavior, DOM structure, or access rules. This project treats those conditions as runtime compatibility constraints rather than attempting to evade them.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — end-to-end architecture and data flow
- [`docs/SECURITY.md`](./docs/SECURITY.md) — credential boundaries and security properties
- [`docs/ANDROID_ACCEPTANCE_TEST.md`](./docs/ANDROID_ACCEPTANCE_TEST.md) — physical-device acceptance protocol
- [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) — deployment/runtime checks
- [`docs/RELEASES.md`](./docs/RELEASES.md) — APK/release process
- [`PRODUCTION_STATUS.md`](./PRODUCTION_STATUS.md) — current launch blockers and readiness state
