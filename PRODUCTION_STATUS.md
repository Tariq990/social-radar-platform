# MR SCRAP — Production Readiness Status

This document is the authoritative launch-gate summary for branch:

`work/real-session-ai-provider`

Current classification: **ALPHA / NOT PRODUCTION READY**.

The implementation now has a real Android/session/backend architecture, but external multi-user production launch is blocked by the P0 items below.

## Core architecture status

| Area | Status | Notes |
|---|---|---|
| React/Vite product UI | ✅ Implemented | Existing UI preserved. |
| Capacitor Android project | ✅ Builds | CI compiles debug APK. |
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
| Full user authentication | ❌ Not implemented | **P0**. Backend CRUD still uses `user_default`. |
| Tenant isolation | ❌ Not implemented | **P0**. Must authorize every CRUD path. |
| Physical Facebook acceptance test | ❌ Not completed | **P0**. Build success does not prove live WebView/DOM behavior. |
| Instagram authenticated-session validation | ⚠️ Partial | Collector accepts Instagram URLs, but login/session behavior is Facebook-first and not independently proven. |
| Production Android signing / Play Store | ❌ Not implemented | P1 release work. |

## Primary monitoring path

Authenticated Facebook monitoring is device-owned:

```text
Facebook real WebView login
→ Android CookieManager session
→ AuthenticatedWebCollector
→ normalized post metadata only
→ HTTPS /api/device/ingest
→ device bearer authentication
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

## Device authorization

`/api/device/ingest` now requires an MR SCRAP device bearer credential.

Server behavior:

- generates an opaque random token;
- stores only SHA-256 digest in the `devices` table;
- rejects missing/invalid tokens.

Android behavior:

- stores the bearer token with AndroidKeyStore-backed AES-GCM encryption;
- does not store it in WorkManager job data;
- clears/re-registers when backend authorization is rejected.

**Important limitation:** device registration is still bound to the temporary `user_default` identity. It is not a substitute for real account authentication/tenant authorization.

## Deduplication

Post identity priority:

1. real external platform post ID;
2. canonical social URL;
3. deterministic normalized content hash fallback.

Canonicalization removes tracking parameters while preserving Facebook identity-bearing query values such as `story_fbid` and `id`.

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

## P0 blockers — must close before external production

### P0-1 — End-user authentication and tenant isolation

Required:

- real signup/login/session model;
- authenticate all user-facing CRUD APIs;
- bind device registration to the logged-in user;
- user-scoped source/rule/alert reads and writes;
- authorization on delete/pause/update operations;
- logout/revocation behavior;
- cross-tenant negative tests proving user A cannot read/change user B data.

Until this is complete, do not expose the current backend as a multi-user public production service.

### P0-2 — Physical Android Facebook acceptance test

Run the full protocol in:

`docs/ANDROID_ACCEPTANCE_TEST.md`

Required evidence includes:

- Facebook real WebView login succeeds on physical hardware;
- session survives app restart where Facebook allows it;
- Share Target receives real URLs;
- real source metadata resolves;
- real posts are extracted;
- repeated scans dedupe correctly;
- AI positive/negative/failure paths behave correctly;
- background WorkManager eventually checks;
- logout/expiry/reconnect works;
- Disconnect clears local Facebook session;
- no raw Facebook cookie/password appears in backend/network/log payloads.

## P1 blockers / launch-scope decisions

- real FCM/Web Push token registration and delivery;
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
3. unit tests;
4. web/server bundle;
5. Capacitor Android sync;
6. Android debug APK compilation;
7. workflow APK artifact upload.

CI proves the code compiles and covered deterministic logic passes tests. It does **not** prove Facebook accepts WebView login or that Meta's live DOM matches the collector selectors.

## Documentation

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/ANDROID_ACCEPTANCE_TEST.md`
- `docs/OPERATIONS.md`
- `docs/RELEASES.md`

## Merge gate for PR #1

Keep PR #1 as **Draft** until at minimum:

1. P0 end-user auth/tenant isolation is implemented and tested;
2. physical Android Facebook acceptance protocol passes with evidence;
3. current CI is green on the final candidate head;
4. another focused security/data-flow review finds no critical blocker.

Do not label this branch “production ready” before those gates are closed.
