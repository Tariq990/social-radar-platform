# MR SCRAP — Production Readiness Status

This document is the authoritative launch-gate summary for branch:

`work/real-session-ai-provider`

Current classification: **ALPHA / NOT PRODUCTION READY**.

The implementation now has a real Android/session/backend architecture plus application-level user authentication and tenant isolation. The remaining P0 launch gate is the physical Android Facebook-session acceptance protocol and a green final-candidate CI run.

## Core architecture status

| Area | Status | Notes |
|---|---|---|
| React/Vite product UI | ✅ Implemented | Existing UI preserved. |
| Application signup/login | ✅ Implemented | Email/password, scrypt password hashing, opaque hashed server sessions. |
| HttpOnly app sessions | ✅ Implemented | Secure credentialed cookie flow; exact-origin CORS. |
| Tenant isolation | ✅ Implemented + tested | User-scoped CRUD, ownership checks, cross-tenant negative integration tests. |
| User-bound Android device auth | ✅ Implemented | Device registration requires app login and binds credential to that user. |
| Logout/revocation | ✅ Implemented | App session is invalidated and associated backend device credentials are revoked. |
| Capacitor Android project | ✅ Builds | CI compiles debug APK; physical-device behavior still requires acceptance evidence. |
| Android Share Target | ✅ Implemented | Receives shared text/URLs; physical-device validation still required. |
| Facebook dedicated WebView login | ✅ Implemented | Real Facebook page, local CookieManager session. Must pass physical-device acceptance. |
| Raw Facebook cookies/passwords stay device-local by contract | ✅ Implemented | No cookie/password field in backend ingestion contract. Physical network/log validation still required. |
| Android local collector | ✅ Implemented | Semantic DOM extraction; inherently sensitive to Meta DOM/login changes. |
| Android WorkManager | ✅ Implemented | Best-effort periodic monitoring, minimum 15 min; not realtime. |
| Backend device bearer auth | ✅ Implemented | Opaque token, server stores SHA-256 digest. |
| Android backend-token storage | ✅ Hardened | AES-GCM with AndroidKeyStore; no bearer in WorkManager Data. |
| PostgreSQL persistence | ✅ Implemented | Production requires DB; no serving from JSON fallback. |
| Post deduplication | ✅ Implemented | External ID → canonical URL → content; source-scoped persisted fingerprint; atomic DB uniqueness. |
| Match deduplication | ✅ Implemented | Unique `(rule_id, post_id)`. |
| Provider-neutral AI | ✅ Implemented | Operator-controlled Base URL/key/model/format. |
| Gemini hardcode removed | ✅ | Gemini Native is one optional adapter, not the business-logic dependency. |
| Apify primary dependency removed | ✅ | Apify remains optional only when explicitly enabled. |
| Fake production posts/matches | ✅ Removed from production paths | Demo mode remains explicitly separated. |
| In-app notification persistence | ✅ Implemented | Durable notification rows. |
| Real FCM/Web Push | ❌ Not implemented | P1 blocker if external push is part of launch promise. |
| Physical Facebook acceptance test | ❌ Not completed | **P0**. Build success does not prove live WebView/DOM behavior. |
| Instagram authenticated-session validation | ⚠️ Partial | Collector accepts Instagram URLs, but login/session behavior is Facebook-first and not independently proven. |
| Production Android signing / Play Store | ❌ Not implemented | P1 release work. |

## Application authentication and tenant boundary

MR SCRAP application authentication is intentionally separate from Facebook authentication:

```text
MR SCRAP email + password
→ scrypt password hash
→ opaque random application session
→ SHA-256 session-token hash in PostgreSQL
→ HttpOnly secure session cookie
→ requireAppAuth
→ authenticated userId
→ user-scoped sources / rules / alerts / scans
→ user-bound Android backend device credential
```

Security properties implemented:

- plaintext application passwords are not stored;
- application session tokens are opaque and only their hashes are stored server-side;
- production cookies are `HttpOnly` and `Secure`;
- cross-origin credential use is restricted to explicitly approved origins rather than `*`;
- source deletion/pause, rule mutation, alert mutation and scans are tenant-authorized;
- a rule cannot be attached to another user's source;
- Android device registration requires an authenticated MR SCRAP user session;
- Android `/api/device/ingest` derives tenant identity from the user-bound device credential;
- application logout revokes associated backend device credentials;
- automated integration coverage proves user B cannot list/delete/pause/rule-bind/ingest into user A resources.

This application account/session is unrelated to the Facebook WebView session. Facebook cookies and passwords remain device-local.

Email verification and self-service password reset are not yet implemented; they are product/account-recovery follow-up work rather than a tenant-isolation bypass.

## Primary monitoring path

Authenticated Facebook monitoring is device-owned:

```text
Facebook real WebView login
→ Android CookieManager session
→ AuthenticatedWebCollector
→ normalized post metadata only
→ HTTPS /api/device/ingest
→ user-bound device bearer authentication
→ PostgreSQL dedupe/persistence
→ active rule selection
→ configured AI provider
→ unique match
→ in-app notification record
```

Raw Facebook passwords/cookies are not part of the React bridge or backend ingestion API.

The collector does not bypass access controls, CAPTCHA, or platform restrictions. If Facebook blocks WebView login, expires the session or changes its DOM, MR SCRAP must return an honest unavailable/reconnect state rather than fake activity.

## AI provider

The AI provider is controlled centrally by the application operator, not end users:

```env
AI_BASE_URL=https://...
AI_API_KEY=...
AI_MODEL=...
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI
```

Supported formats:

- `openai_chat`
- `openai_responses`
- `gemini_native`

Remote AI endpoints require HTTPS in production. Provider failure must not create fabricated successful matches.

## Persistence

Production requires:

```env
APP_MODE=production
DATABASE_URL=postgresql://...
```

If PostgreSQL is unavailable, production startup is aborted before the app serves production traffic. Local JSON persistence is development/demo-only.

Authentication schema includes:

- `users.password_hash`;
- case-insensitive unique email index;
- `app_sessions` with hashed opaque session tokens, expiry and revocation metadata;
- `devices.user_id` binding backend device authorization to the authenticated application tenant.

## Device authorization

`/api/device/ingest` requires an MR SCRAP device bearer credential.

Server behavior:

- device registration itself requires a valid MR SCRAP application session;
- generates an opaque random device token;
- stores only its SHA-256 digest in the `devices` table;
- binds the device row to the authenticated `user_id`;
- rejects missing/invalid/revoked tokens;
- logout can revoke the user's associated device credentials.

Android behavior:

- stores the backend device bearer with AndroidKeyStore-backed AES-GCM encryption;
- does not store it in WorkManager job data;
- clears/re-registers when backend authorization is rejected.

## Deduplication

Post identity priority:

1. real external platform post ID;
2. canonical social URL;
3. deterministic normalized content hash fallback.

Canonicalization removes tracking parameters while preserving Facebook identity-bearing query values such as `story_fbid` and `id`, and normalizes equivalent Facebook/Instagram host forms before URL fingerprinting.

The persisted fingerprint is source-scoped before insertion so the same public post monitored by different sources/users cannot suppress another user's processing.

## Notifications

Current:

```text
Match → durable notification DB record → Alerts UI
```

Not yet real:

```text
FCM / Web Push external delivery
```

External adapters intentionally return “not configured” rather than claiming successful delivery.

## Release / APK status

Pull-request CI builds a short-lived debug APK artifact.

A separate workflow, `.github/workflows/android-alpha-release.yml`, is prepared to publish a mutable GitHub prerelease:

`MR SCRAP Android Alpha` / tag `android-alpha`

It requires a real HTTPS backend origin through repository variable `ALPHA_API_BASE_URL` or manual workflow input. If no real backend URL is provided, the automatic alpha-release job skips instead of publishing a broken APK.

Alpha APKs are debug builds and are not Play Store production releases.

## P0 blocker — must close before external production

### P0 — Physical Android Facebook acceptance test

Run the full protocol in:

`docs/ANDROID_ACCEPTANCE_TEST.md`

Required evidence includes:

- Facebook real WebView login succeeds on physical hardware;
- application login/session works in the installed Android build;
- session survives app restart where Facebook allows it;
- Share Target receives real URLs;
- real source metadata resolves;
- real posts are extracted;
- repeated scans dedupe correctly;
- AI positive/negative/failure paths behave correctly;
- background WorkManager eventually checks;
- MR SCRAP logout revokes backend application/device authorization;
- Facebook logout/expiry/reconnect works honestly;
- Disconnect clears local Facebook session;
- no raw Facebook cookie/password appears in backend/network/log payloads.

## P1 blockers / launch-scope decisions

- real FCM/Web Push token registration and delivery;
- email verification and password reset/account recovery;
- independently validate Instagram authenticated flow;
- collector regression/resilience testing against live Meta layouts;
- release signing / AAB / Play Store workflow;
- final icons/store assets/privacy policy/data disclosures;
- managed PostgreSQL backup/restore validation;
- production-grade distributed rate limiting/observability if scaling beyond one backend process.

## CI verification

`.github/workflows/verify-real-session.yml` validates:

1. dependency installation;
2. TypeScript typecheck;
3. unit and integration tests, including authentication/tenant isolation;
4. web/server bundle;
5. Capacitor Android sync;
6. Android debug APK compilation;
7. workflow APK artifact upload.

CI proves the code compiles and covered deterministic/backend authorization logic passes tests. It does **not** prove Facebook accepts WebView login or that Meta's live DOM matches the collector selectors.

## Documentation

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/ANDROID_ACCEPTANCE_TEST.md`
- `docs/OPERATIONS.md`
- `docs/RELEASES.md`

## Merge gate for PR #1

Keep PR #1 as **Draft** until at minimum:

1. physical Android Facebook acceptance protocol passes with evidence;
2. current CI is green on the final candidate head;
3. another focused security/data-flow review finds no critical blocker.

Do not label this branch “production ready” before those gates are closed.
