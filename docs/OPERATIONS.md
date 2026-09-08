# Operations Runbook — MR SCRAP

## 1. Deployment model

The current architecture has two runtime surfaces:

1. **Hosted backend/web application** — Express + Vite bundle + PostgreSQL + centrally configured AI provider + MR SCRAP application authentication.
2. **Android application** — Capacitor bundle plus native Facebook WebView/session collector and WorkManager.

The Android application must be compiled with the public HTTPS backend origin.

## 2. Required production configuration

Minimum backend configuration:

```env
APP_MODE=production
DATABASE_URL=postgresql://...

AI_BASE_URL=https://provider.example/v1
AI_API_KEY=...
AI_MODEL=...
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI

APP_URL=https://app.example.com
ADMIN_API_TOKEN=<long-random-secret>
```

Optional:

```env
CORS_ALLOWED_ORIGINS=https://other-frontend.example
PUBLIC_PROVIDER=apify
APIFY_API_TOKEN=...
FCM_SERVER_KEY=...
```

Notes:

- Apify is optional and not the primary monitoring architecture.
- `FCM_SERVER_KEY` alone does not enable push; token registration/delivery is still unfinished.
- `ADMIN_API_TOKEN` must never be compiled into the frontend or Android application.
- remote `AI_BASE_URL` must use HTTPS in production.
- application session cookies are generated dynamically; no static application-session secret is configured.

## 3. Android build configuration

Every Android build intended to communicate with a real backend must use:

```env
VITE_API_BASE_URL=https://api.example.com
```

If this is missing in a native Android build, the client intentionally fails with a configuration error rather than sending API calls to the bundled `https://localhost` origin.

The Capacitor main WebView runs at `https://localhost`; production application auth relies on an HttpOnly Secure SameSite=None cookie to the explicitly allowed hosted HTTPS backend. The WebView is configured to accept that MR SCRAP credential cookie. This must be verified on physical hardware before launch.

## 4. Startup behavior

Production startup performs these gates:

1. initialize PostgreSQL;
2. execute idempotent schema/migration SQL;
3. require PostgreSQL to be active;
4. validate the centrally configured AI provider fields;
5. refuse production startup if persistence/AI configuration is incomplete.

There is no longer a synthetic `user_default` production identity bootstrap. End users must register/login through the application auth flow.

Production must not serve traffic using the development JSON data store.

## 5. Application authentication operation

Main routes:

```http
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
POST /api/auth/logout-all
```

Operational properties:

- passwords are scrypt-hashed before persistence;
- app sessions use opaque random tokens and hash-only server persistence;
- the browser/native UI receives an HttpOnly session cookie;
- logout revokes the active application session and associated backend device credentials;
- logout-all revokes every application session and backend device credential for that user;
- private CRUD routes require the authenticated tenant session.

Account recovery/email verification are not yet implemented. Treat lost-password support as an explicit follow-up before broad consumer launch.

## 6. Health checks

Public health:

```http
GET /api/health
```

Expected high-level fields include:

- service status;
- `databaseType`;
- `aiConfigured`;
- monitoring mode;
- optional public provider state;
- application mode.

The public health route intentionally does not disclose the AI API key or detailed operator credentials.

Operator-only AI connectivity probe:

```http
GET /api/internal/ai/health
X-MR-SCRAP-ADMIN-TOKEN: <ADMIN_API_TOKEN>
```

In production an invalid/missing admin token returns a not-found style response.

## 7. Database migrations

Current migration entry point:

`server/db/schema.sql`

The backend executes this script during DB initialization.

Operational rules:

- take a PostgreSQL backup/snapshot before applying destructive future migrations;
- keep migrations forward-compatible and idempotent where possible;
- never manually remove post/match/session uniqueness constraints without a migration plan;
- verify schema on staging before production.

Current critical constraints:

- case-insensitive unique user email;
- unique application session token hash;
- unique source identity per user/platform/external ID;
- unique backend device token digest;
- unique persisted post fingerprint;
- unique match per rule/post.

## 8. Monitoring operation

### Authenticated device sources

`device_session` sources are not fetched by the server monitoring worker. The Android device loads them with the local WebView session and sends normalized post metadata to:

```http
POST /api/device/ingest
Authorization: Bearer <MR-SCRAP-device-token>
```

The backend device bearer is generated only after authenticated MR SCRAP device registration and is bound to that user's tenant. It is unrelated to Facebook cookies.

### Optional server provider

If explicitly enabled:

```env
PUBLIC_PROVIDER=apify
APIFY_API_TOKEN=...
```

the server can use the optional provider for compatible public sources.

It must not become a hidden fallback for failed authenticated monitoring.

## 9. Background monitoring expectations

Android WorkManager is best-effort.

Current minimum periodic interval: **15 minutes**.

Operationally do not promise:

- exact 15-minute execution;
- instant/realtime collection while app is closed;
- execution while Android/vendor battery policies prevent it.

Surface delayed/background/reconnect states honestly.

## 10. Logs and secret handling

Never log:

- MR SCRAP plaintext password;
- raw MR SCRAP application session token;
- backend device bearer token;
- Facebook password;
- raw Facebook cookies;
- `c_user` / `xs` values;
- AI API key;
- PostgreSQL credentials;
- Android signing secrets.

Connector events may store non-secret operational details only.

When logging errors from external providers, avoid dumping raw HTTP request headers/bodies that could contain credentials.

## 11. CORS

Production browser origins are explicit.

Built-in Capacitor origin:

```text
https://localhost
```

Additional web origins are configured through:

```env
APP_URL=
CORS_ALLOWED_ORIGINS=
```

Credentialed responses use `Access-Control-Allow-Credentials: true` only after exact origin approval. Do not use `Access-Control-Allow-Origin: *` for production authenticated APIs.

WorkManager native HTTP calls are not browser CORS requests and authenticate with the device bearer token.

## 12. Rate limiting

The current rate limiter is in-process and suitable only as a basic single-instance alpha guard.

Before multi-instance production deployment:

- move/augment limiting at gateway/CDN/Redis/shared infrastructure;
- scope buckets by route/action as well as client identity/IP;
- monitor auth abuse separately from normal API traffic.

The current application periodically removes expired in-memory entries to avoid unbounded map growth.

## 13. Notification operation

Current state:

- matches create durable notification records;
- alerts are visible in-app;
- FCM/Web Push interfaces exist but external push delivery is not complete.

Never mark a notification as externally delivered until the provider actually acknowledges delivery/request acceptance.

## 14. Incident responses

### Database unavailable

Expected production behavior: startup/operation fails rather than silently using local JSON.

Actions:

1. verify `DATABASE_URL`;
2. check PostgreSQL network/TLS availability;
3. check connection limits;
4. inspect migration error;
5. restore from backup only if data corruption is confirmed.

### Application auth failures

Actions:

1. verify PostgreSQL availability and `app_sessions` migration;
2. verify the client origin is present in `APP_URL`/`CORS_ALLOWED_ORIGINS`;
3. verify HTTPS is in use and the production session cookie is accepted;
4. on Android, verify the target WebView accepts the MR SCRAP credential cookie;
5. confirm server time is correct so session expiry comparisons are valid;
6. do not disable tenant authorization to work around an auth problem.

### AI provider unavailable

Expected behavior:

- rule evaluation errors are recorded/logged;
- no fabricated match is generated.

Actions:

1. call the admin-only AI health endpoint;
2. verify provider endpoint, key, model and API format;
3. verify TLS/DNS;
4. change central provider variables if switching provider;
5. restart/redeploy backend.

### Facebook session expired

Expected behavior:

- source requires reconnect;
- no server-side Facebook cookie fallback.

Action: user reconnects Facebook on the Android device.

### Collector breaks after Meta DOM change

Expected behavior:

- collection returns empty/error/needs-attention honestly;
- do not fabricate posts.

Action:

1. reproduce on a physical test device;
2. inspect only currently rendered/allowed page structure;
3. update semantic extraction logic;
4. run Android acceptance protocol again.

### Backend device token rejected

Foreground client re-registers only while a valid MR SCRAP app session exists. Background worker clears the rejected AndroidKeyStore-backed credential and requires the app to reopen/re-authenticate/re-register before scheduling resumes.

## 15. Backup / recovery

Before production:

- enable managed PostgreSQL automated backups;
- define recovery-point and recovery-time objectives;
- test restore procedure;
- keep application deploy rollback independent of DB destructive migrations.

Facebook WebView sessions are device-local and intentionally are not part of backend backup.

## 16. Rollback

Application rollback procedure:

1. identify last known-good commit/release;
2. verify DB schema remains backward-compatible with that release;
3. redeploy backend/web version;
4. distribute prior Android build only if its backend/auth contract remains compatible;
5. monitor `/api/health`, auth errors, connector events and ingestion errors.

Never force a code rollback across a destructive DB migration without a verified migration/recovery plan.

## 17. Pre-launch operations gate

Before external production launch confirm:

- tenant auth integration tests green on final candidate;
- physical Android MR SCRAP auth cookie flow passed;
- physical Facebook WebView/collector acceptance test passed;
- PostgreSQL backup/restore tested;
- production HTTPS backend stable;
- AI provider health stable;
- push-delivery claims match actual implementation;
- Play Store signing/release process completed if distributing through Play;
- privacy policy/data handling accurately describes application auth and device-local Facebook session behavior.
