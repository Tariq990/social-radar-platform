# MR SCRAP — Production Readiness Status

This document is the authoritative launch-gate summary for the **current repository state**.

Validation/evidence is maintained on:

`test/android-headless-emulator-20260909` — Draft PR #7, validation-only, **DO NOT MERGE AS-IS**.

The older provider/production integration lane remains protected and owner-blocked:

`work/real-session-ai-provider` — Draft PR #1.

Current classification: **ALPHA / NOT PRODUCTION READY**.

The application/server/Android validation tree is code-complete GREEN. The remaining P0 launch gate is the full physical Android Facebook-session acceptance protocol on real hardware. After that succeeds, a **clean promotion branch from the then-current `main`** must be created and the complete code gate rerun before merge; PR #7 itself is evidence, not the final merge candidate.

## Core architecture status

| Area | Status | Notes |
|---|---|---|
| React/Vite product UI | ✅ Implemented | Existing UI preserved. |
| Application signup/login | ✅ Implemented | Email/password, scrypt password hashing, opaque hashed server sessions. |
| HttpOnly app sessions | ✅ Implemented | Secure credentialed cookie flow; exact-origin CORS. |
| Tenant isolation | ✅ Implemented + tested | User-scoped CRUD, ownership checks, cross-tenant negative integration tests. |
| User-bound Android device auth | ✅ Implemented | Device registration requires app login and binds credential to that user. |
| Logout/revocation | ✅ Implemented | App session is invalidated and associated backend device credentials are revoked. |
| Capacitor Android project | ✅ Builds | Current validation gate compiles a debug APK; physical-device behavior still requires acceptance evidence. |
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

## Current validation evidence

Draft PR #7 is the evidence lane. Current policy:

- keep PR #7 Draft and do not merge it as-is;
- use **Code Complete Gate** on the isolated self-hosted Linux validation runner for executable frontend/backend/Android verification;
- the duplicate hosted `Verify Real Session Architecture` PR job is intentionally skipped on the validation lane and protected provider lane because hosted jobs on this repository were failing before runner assignment;
- use **Android Physical ADB Final Gate** only by manual dispatch after a real external device-state change makes one authorized physical Android target available;
- do not loop USB/ADB probes while no phone is enumerated;
- preserve installed app/session state and use `adb install -r` only after signing-certificate compatibility is proven;
- no uninstall, app-data wipe, WebView/session reset, secret access, Production/provider mutation or fake acceptance substitute is authorized by this lane.

The current code-complete evidence and APK artifact are recorded in PR #7. The physical matrix remains open in Issue #3.

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

The current validation lane produces short-lived debug APK artifacts through `.github/workflows/code-complete-gate.yml`.

A separate `.github/workflows/android-alpha-release.yml` path exists for controlled alpha distribution. It is **outside the current validation authority** and must not be treated as production signing or a substitute for physical acceptance.

Alpha/debug APKs are not Play Store production releases.

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

The automated physical gate is a non-destructive prerequisite/collector proof only; it does not replace the full matrix.

## P1 blockers / launch-scope decisions

- real FCM/Web Push token registration and delivery;
- email verification and password reset/account recovery;
- independently validate Instagram authenticated flow;
- collector regression/resilience testing against live Meta layouts;
- release signing / AAB / Play Store workflow;
- final icons/store assets/privacy policy/data disclosures;
- managed PostgreSQL backup/restore validation;
- production-grade distributed rate limiting/observability if scaling beyond one backend process.

Issues #4, #5 and #6 remain owner-blocked for the external/device/production portions of that work.

## CI verification

### Validation lane

`.github/workflows/code-complete-gate.yml` verifies on the isolated self-hosted Linux runner:

1. locked dependency installation with `npm ci`;
2. TypeScript typecheck;
3. unit/integration/regression tests;
4. web/server bundle;
5. Capacitor Android sync;
6. Android debug APK compilation;
7. workflow APK artifact upload.

### Generic hosted verification

`.github/workflows/verify-real-session.yml` retains equivalent generic/manual verification capability, but its automatic PR job is intentionally skipped for the validation lane and protected provider lane to avoid duplicate/failing hosted runner work.

CI proves compilation and covered deterministic/backend authorization logic. It does **not** prove Facebook accepts WebView login or that Meta's live DOM matches the collector selectors.

## Dependency / supply-chain status

The validation lane uses a committed `package-lock.json`, `npm ci`, immutable reviewed GitHub Action SHAs and regression checks for the workflow allowlist/permissions.

Current locked dependency audit recorded in PR #7:

- 0 critical;
- 0 high;
- 5 moderate residual advisories.

A non-forced lockfile-only audit fix made no supported change. Do not use unsupported overrides/downgrades or a framework/server-major migration merely to churn the validated lane; re-evaluate these residuals during clean promotion/dependency upgrade work.

## Documentation

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/ANDROID_ACCEPTANCE_TEST.md`
- `docs/OPERATIONS.md`
- `docs/RELEASES.md`

## Promotion gate

Do **not** merge PR #7 as-is. Keep PR #1 protected/owner-blocked unless its provider/Production scope is explicitly reopened.

After the physical P0 matrix passes:

1. preserve PR #7 as evidence;
2. create a clean promotion branch from the then-current `main`;
3. promote only intended product/server/Android/docs/tests and minimal permanent CI;
4. exclude obsolete diagnostic/probe/apply workflows and the alpha/debug-only test keystore from the production/main promotion path;
5. rerun the complete Code Complete Gate on the clean promotion tree;
6. perform a focused security/data-flow review;
7. only then consider merge/release progression.

Do not label the product “production ready” before those gates are closed.
