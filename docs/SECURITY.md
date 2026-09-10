# Security Model — MR SCRAP

## Scope

This document describes the security/trust boundaries of the current repository architecture. It is not a claim that the application is production-ready.

Current validation/evidence is maintained on `test/android-headless-emulator-20260909` (Draft PR #7, validation-only, **DO NOT MERGE AS-IS**). The older `work/real-session-ai-provider` lane remains a protected/owner-blocked provider/Production branch and is not the active validation lane.

## 1. Facebook authentication boundary

The Facebook login session belongs to the Android device.

Expected properties:

- user types credentials into Facebook's real page inside `FacebookSessionActivity`;
- the application does not provide a look-alike Facebook password form;
- raw password values are never sent to the MR SCRAP backend;
- raw WebView cookie values are never sent through the React/Capacitor bridge;
- raw Facebook cookies are never included in backend ingestion requests;
- local collection can access only content the authenticated user is actually able to load.

The application does not claim or implement CAPTCHA bypass, access-control bypass, anti-bot evasion or session export.

## 2. MR SCRAP application authentication

MR SCRAP account authentication is separate from Facebook authentication.

Current implementation:

- email/password registration and login;
- passwords hashed with `scrypt` and random salt before persistence;
- opaque cryptographically random application session token;
- only SHA-256 session-token digest stored in PostgreSQL;
- session expiry persisted in `app_sessions`;
- application session cookie is `HttpOnly`;
- production cookie is `Secure` and `SameSite=None` for the Capacitor `https://localhost` → hosted HTTPS API topology;
- credentialed CORS uses exact approved origins, never wildcard origin;
- private user-facing API routes use `requireAppAuth`.

Tenant authorization currently covers:

- source list/create/delete/pause;
- source resolution used by a logged-in app session;
- rule list/create/delete/toggle;
- validation that rule source IDs belong to the same tenant;
- alert list/update;
- user-scoped scanning;
- AI suggestions/digest/preview user routes;
- device registration.

Cross-tenant integration tests verify that user B cannot list, delete, pause, bind rules to, or ingest into user A resources.

Account-recovery follow-up still required before mature consumer launch:

- email verification;
- password reset/recovery;
- optional stronger authentication/MFA policy if product risk warrants it.

These are important account-product controls but are distinct from the implemented tenant-isolation boundary.

## 3. MR SCRAP backend device credential

This credential is separate from both Facebook authentication and the MR SCRAP browser/application session.

Server:

- device registration requires an authenticated MR SCRAP application session;
- creates an opaque random bearer token;
- stores only SHA-256 token digest in PostgreSQL;
- binds the `devices` row to the authenticated application `user_id`;
- `/api/device/ingest` derives tenant identity from the validated device token;
- missing/invalid/revoked device tokens are rejected;
- application logout revokes the user's associated backend device credentials.

Android:

- stores the bearer token encrypted at rest;
- AES-GCM key is generated and held by AndroidKeyStore;
- encrypted ciphertext is held in private app preferences;
- WorkManager input/output data never contains the bearer token;
- app backup is disabled.

## 4. Session cookies in Capacitor

The bundled Capacitor UI runs at `https://localhost` while production API traffic can target a separate HTTPS origin.

To support the `HttpOnly; Secure; SameSite=None` application-session cookie:

- JavaScript fetches use `credentials: include`;
- server CORS returns `Access-Control-Allow-Credentials: true` only for explicitly allowed origins;
- the Android main WebView explicitly accepts credential cookies;
- cookie contents remain inaccessible to normal JavaScript because the session cookie is `HttpOnly`.

This cookie is an MR SCRAP application session, not a Facebook cookie. Facebook session storage remains in the dedicated Facebook WebView boundary.

Physical Android acceptance must confirm this credential-cookie topology on the actual target WebView version.

## 5. AI secrets

`AI_API_KEY` is server-only.

Rules:

- never compile AI credentials into Vite/Android bundles;
- never return `AI_API_KEY` from API responses;
- never log AI secrets;
- production remote `AI_BASE_URL` must use HTTPS;
- internal AI health/probe endpoints require `ADMIN_API_TOKEN` in production.

End users do not configure AI providers.

## 6. Database behavior

Production requires PostgreSQL.

If `DATABASE_URL` is missing/unreachable under `APP_MODE=production`, startup fails. Production must never silently switch to the local JSON store.

Critical controls include:

- case-insensitive unique application email;
- unique application session-token digest;
- sources unique by user/platform/external ID;
- backend device token digest unique;
- post fingerprint unique;
- matches unique by rule + post.

Post fingerprints are prefixed by `source.id` before persistence, preventing the same post monitored by different sources/users from suppressing another tenant's processing.

## 7. Input validation

Backend validates or constrains:

- Facebook/Instagram URL hosts;
- maximum ingestion batch size;
- media URL protocol;
- timestamps;
- metadata key names that could resemble session/password/token fields;
- rule sizes/counts;
- rule-to-source ownership;
- AI result structure and confidence range;
- application email/password shape and length.

Production source creation requires a real resolved `externalId` or handle; it does not fabricate an identifier.

## 8. CORS and transport

Production CORS uses explicit origins only.

Allowed native browser origin:

- `https://localhost` (Capacitor Android)

Additional browser origins come from `APP_URL` / `CORS_ALLOWED_ORIGINS`.

Credentialed browser requests receive `Access-Control-Allow-Credentials: true` only after origin approval. Disallowed browser origins receive 403 before application route handling.

WorkManager requests do not carry browser `Origin`; they authenticate with the user-bound device bearer credential.

Android cleartext traffic is disabled. The alpha/release Android backend origin must be HTTPS.

## 9. Android WebView controls

Current hardening includes:

- WebView debugging disabled on the Facebook login activity;
- file/content access disabled for the Facebook login WebView;
- mixed content blocked;
- navigation constrained to Facebook during the Facebook login flow;
- application backup disabled;
- main Capacitor WebView accepts the MR SCRAP hosted-API application-session cookie while server exact-origin CORS remains authoritative.

Remaining risk: WebView/platform behavior can change. Login, cross-origin app session cookies and DOM extraction require physical-device regression testing.

## 10. Data minimization

Backend ingestion should contain only normalized source/post information needed for matching.

The ingestion sanitizer rejects secret-looking metadata keys such as:

- cookie/cookies
- password/passwd
- session/sessionid
- `c_user`
- `xs`
- token/access_token

Android collector metadata is also sanitized before network egress. This is defense-in-depth; the collector contract should not include social authentication material in the first place.

## 11. Build / CI supply-chain boundary

The validation lane uses:

- committed `package-lock.json`;
- `npm ci` rather than a floating install graph;
- reviewed immutable GitHub Action commit SHAs in permanent validation gates;
- read-only default workflow permissions for validation;
- regression checks covering action SHA allowlists, lockfile usage, no `pull_request_target`, and the manual-only physical gate.

The executable validation path for PR #7 is `.github/workflows/code-complete-gate.yml` on the isolated self-hosted Linux validation runner. The generic hosted `verify-real-session.yml` job is intentionally skipped automatically on the validation lane and protected provider lane because hosted jobs on this repository were failing before runner assignment; manual dispatch remains available.

Current locked dependency audit recorded in PR #7 is 0 critical, 0 high, 5 moderate residual advisories. A non-forced lockfile-only remediation made no supported change. Do not introduce unsupported overrides/downgrades or major framework/server migrations solely to hide moderate-only audit output on the validated lane.

## 12. Physical acceptance state preservation

The physical acceptance candidate must preserve evidence already present on the device:

- do not uninstall MR SCRAP merely to update the candidate;
- do not clear app data, WebView data or Facebook cookies as an update step;
- verify installed/candidate signing certificates match before replacement;
- use `adb install -r` only after compatibility is proven;
- stop fail-closed on incompatible signatures instead of destroying the session;
- run the automated Android Physical ADB Final Gate only after an external device-state change produces one authorized real device.

The automated gate is a prerequisite/collector proof, not a substitute for the full matrix in `docs/ANDROID_ACCEPTANCE_TEST.md`.

## 13. Remaining P0/P1 risks

### P0 — physical Android Facebook acceptance test

Must verify on real hardware:

- MR SCRAP application login cookie works from the Capacitor app to the production HTTPS API;
- Facebook permits the dedicated WebView login flow;
- Facebook cookies persist across app restart where allowed;
- collected source metadata is real;
- post extraction works for supported layouts;
- expired sessions are detected;
- MR SCRAP logout invalidates application access and backend device authorization;
- Facebook disconnect clears the local Facebook session;
- no raw Facebook cookie/password values appear in logs/network/backend payloads.

Current blocker classification: `OWNER_BLOCKED: NO_PHONE_USB_ENUMERATION`.

### P1 — account recovery

Email verification and password-reset/recovery are not yet implemented.

### P1 — push delivery

FCM/Web Push interfaces exist but external delivery is not complete. Do not mark notifications as externally delivered until token/subscription persistence and real delivery acknowledgements exist.

### P1 — release signing / Play Store

Current validation/alpha APKs are debug builds. Production signing keys, release keystore handling, Play Integrity/store requirements, privacy declarations and package hardening remain separate release work.

### P1 — production scaling controls

The current in-process IP rate limiter is suitable for a single alpha backend instance, not a distributed fleet. Move to a shared store/gateway limiter before horizontal scale and scope limiter buckets per route/action.

## 14. Operational rules

Never commit or expose production-sensitive material such as:

- `.env` files;
- AI API keys;
- PostgreSQL credentials;
- **production** Android signing keys/passwords;
- service-account/deployment credentials;
- Facebook cookies/session exports.

PR #7 contains an alpha/debug-only test keystore solely to preserve sideload signing continuity during validation. It must not be promoted to `main` or reused for production/Play signing.

Never add a fallback that turns a failed connector/AI request into a fake successful production result.

## 15. Security review / promotion gate

Do not promote any candidate as production-ready until:

1. authenticated tenant-scoped API access remains enforced;
2. the physical P0 application/Facebook session matrix passes on real hardware;
3. no secret leakage is observed in Android/background/network/backend boundaries;
4. release environment uses HTTPS;
5. database migrations and dedupe are stable under concurrent ingestion;
6. the clean promotion candidate CI is green;
7. the promotion diff excludes obsolete diagnostic/probe/apply workflows and the alpha/debug-only test keystore.

PR #7 must remain evidence-only. After physical PASS, create a clean promotion branch from the then-current `main` and rerun the complete code/security checks there.
