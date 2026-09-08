# Security Model — MR SCRAP

## Scope

This document describes the security/trust boundaries of the current `work/real-session-ai-provider` implementation. It is not a claim that the application is production-ready.

## Trust boundaries

### 1. Facebook authentication boundary

The Facebook login session belongs to the Android device.

Expected properties:

- user types credentials into Facebook's real page inside `FacebookSessionActivity`;
- the application does not provide a look-alike Facebook password form;
- raw password values are never sent to the MR SCRAP backend;
- raw WebView cookie values are never sent through the React/Capacitor bridge;
- raw Facebook cookies are never included in backend ingestion requests;
- local collection can access only content the authenticated user is actually able to load.

The application does not claim or implement CAPTCHA bypass, access-control bypass, anti-bot evasion or session export.

## 2. MR SCRAP backend device credential

This credential is separate from Facebook authentication.

Server:

- creates an opaque random bearer token;
- stores only SHA-256 token digests in PostgreSQL;
- `/api/device/ingest` requires a valid bearer token.

Android:

- stores the bearer token encrypted at rest;
- AES-GCM key is generated and held by AndroidKeyStore;
- encrypted ciphertext is held in private app preferences;
- WorkManager input/output data never contains the bearer token;
- app backup is disabled.

Remaining risk: device registration is still tied to the current `user_default` backend identity rather than a real authenticated user. This is a **P0 blocker** before external multi-user production use.

## 3. AI secrets

`AI_API_KEY` is server-only.

Rules:

- never compile AI credentials into Vite/Android bundles;
- never return `AI_API_KEY` from API responses;
- never log AI secrets;
- production remote `AI_BASE_URL` must use HTTPS;
- internal AI health/probe endpoints require `ADMIN_API_TOKEN` in production.

End users do not configure AI providers.

## 4. Database behavior

Production requires PostgreSQL.

If `DATABASE_URL` is missing/unreachable under `APP_MODE=production`, startup fails. Production must never silently switch to the local JSON store.

Critical uniqueness controls:

- sources unique by user/platform/external ID;
- backend device token digest unique;
- post fingerprint unique;
- matches unique by rule + post.

Post fingerprints are prefixed by `source.id` before persistence, preventing the same post monitored by different sources/users from suppressing another tenant's processing.

## 5. Input validation

Backend validates:

- Facebook/Instagram URL hosts;
- maximum ingestion batch size;
- media URL protocol;
- timestamps;
- metadata key names that could resemble session/password/token fields;
- rule sizes/counts;
- AI result structure and confidence range.

Production source creation requires a real resolved `externalId` or handle; it does not fabricate an identifier.

## 6. CORS and transport

Production CORS uses explicit origins only.

Allowed native browser origin:

- `https://localhost` (Capacitor Android)

Additional browser origins come from `APP_URL` / `CORS_ALLOWED_ORIGINS`.

WorkManager requests do not carry browser `Origin`; they authenticate with the device bearer credential.

Android cleartext traffic is disabled. The alpha/release Android backend origin must be HTTPS.

## 7. Android WebView controls

Current hardening includes:

- WebView debugging disabled on the Facebook login activity;
- file/content access disabled;
- mixed content blocked;
- navigation constrained to Facebook during the Facebook login flow;
- application backup disabled.

Remaining risk: WebView/platform behavior can change. Login and DOM extraction require physical-device regression testing.

## 8. Data minimization

Backend ingestion should contain only normalized source/post information needed for matching.

The ingestion sanitizer rejects secret-looking metadata keys such as:

- cookie/cookies
- password/passwd
- session/sessionid
- `c_user`
- `xs`
- token/access_token

This sanitizer is defense-in-depth; the Android collector contract should not include these values in the first place.

## 9. Known P0/P1 risks

### P0 — end-user authentication / tenant isolation

Current general CRUD endpoints still operate against `user_default` and are not protected by a full user session. Before external production:

- implement real end-user auth;
- bind device registration to the authenticated account;
- authorize every source/rule/alert mutation by tenant;
- add cross-tenant negative tests;
- add logout/revocation/expired-session behavior.

### P0 — physical Android Facebook acceptance test

Must verify on real hardware:

- Facebook permits the WebView login flow;
- cookies persist across app restart;
- collected source metadata is real;
- post extraction works for supported layouts;
- expired sessions are detected;
- disconnect clears the local Facebook session;
- no raw cookie values appear in logs/network/backend payloads.

### P1 — push delivery

FCM/Web Push interfaces exist but external delivery is not complete. Do not mark notifications as externally delivered until token/subscription persistence and real delivery acknowledgements exist.

### P1 — release signing / Play Store

Current alpha APK is a debug build. Production signing keys, release keystore handling, Play Integrity/store requirements, privacy declarations and package hardening remain separate release work.

## 10. Operational rules

Never commit:

- `.env` files;
- AI API keys;
- PostgreSQL credentials;
- Android signing keys;
- `google-services.json` if it contains environment-specific sensitive configuration not intended for the repository;
- Facebook cookies/session exports.

Never add a fallback that turns a failed connector/AI request into a fake successful production result.

## 11. Security review gate

Do not merge the architecture PR as production-ready until all P0 items are closed and a new audit confirms:

1. authenticated tenant-scoped API access;
2. physical-device session behavior;
3. no secret leakage in Android/background storage;
4. release environment uses HTTPS;
5. database migrations and dedupe are stable under concurrent ingestion.
