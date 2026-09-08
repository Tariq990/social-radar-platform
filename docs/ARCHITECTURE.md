# Architecture — MR SCRAP Social Radar

## 1. Product objective

MR SCRAP is a personal social radar. A user selects Facebook/Instagram sources, writes natural-language rules, and receives alerts only when new content matches those rules.

The product is intentionally **not** a raw scraping/feed dashboard.

## 2. Identity and trust boundaries

The architecture deliberately separates three credentials:

```text
MR SCRAP application session
  └─ identifies the end-user tenant

MR SCRAP backend device bearer
  └─ authorizes Android background ingestion for that tenant

Facebook WebView session
  └─ remains local to Android and is used only to load social content the user can access
```

The Facebook password/cookies are never reused as MR SCRAP backend credentials.

## 3. Application authentication path

```text
User email + password
        │
        ▼
POST /api/auth/register or /api/auth/login
        │
        ├─ password → scrypt + random salt
        ├─ opaque random app-session token
        ├─ SHA-256 token hash → app_sessions
        └─ HttpOnly Secure cookie → client
                │
                ▼
           requireAppAuth
                │
                ▼
          authenticated userId
                │
                ├─ sources
                ├─ rules
                ├─ alerts
                ├─ scans
                └─ device registration
```

Private CRUD routes are tenant-scoped. Ownership is checked before mutations, and rule source IDs must belong to the authenticated tenant.

## 4. Primary production monitoring path

The primary architecture for sources that require login is device-owned:

```text
Authenticated MR SCRAP user
  │
  ├─ register Android backend device credential
  │      └─ device row bound to MR SCRAP user_id
  │
  ▼
Android app
  │
  ├─ FacebookSessionActivity
  │    └─ real Facebook WebView login
  │
  ├─ CookieManager
  │    └─ Facebook session remains device-local
  │
  ├─ AuthenticatedWebCollector
  │    └─ watched source loaded with user's local session
  │
  ├─ normalized post metadata
  │
  └─ HTTPS POST /api/device/ingest
         │
         ├─ user-bound device bearer authentication
         ▼
Backend
  ├─ tenant/source ownership lookup
  ├─ validation/sanitization
  ├─ deterministic dedupe
  ├─ PostgreSQL insert
  ├─ rule selection
  ├─ operator-configured AI evaluation
  ├─ match persistence
  └─ notification record
```

### Data that must remain on Android

- Facebook password.
- Raw Facebook cookies/session values.
- Raw Facebook WebView session state.
- AndroidKeyStore cryptographic key material.

### Data allowed to leave Android

Only normalized post/source data needed by the product, for example:

- source ID
- post external ID when available
- canonical post URL
- author/source display metadata
- text/caption
- media URLs when present
- publish timestamp when available
- collector metadata that contains no session secrets
- the separate MR SCRAP backend device bearer in the Authorization header

## 5. Android components

### `MainActivity`

Responsibilities:

- Capacitor bridge host;
- receives Android `ACTION_SEND` text/plain shares and dispatches them into React;
- enables credential cookies for the approved cross-origin MR SCRAP hosted API topology so the HttpOnly application-session cookie can work from the bundled `https://localhost` Capacitor origin.

This credential cookie belongs to MR SCRAP, not Facebook.

### `FacebookSessionActivity`

Dedicated login surface that loads Facebook's real website. Credentials are entered directly into the website. The app does not present a fake login form or intercept password fields.

### `SessionStateStore`

Stores non-secret timestamps such as `connected_at` and `last_checked_at`. Facebook authentication validity is inferred from WebView `CookieManager` state.

### `AuthenticatedWebCollector`

Loads an allowed Facebook/Instagram URL in an app-owned WebView using the local session. It extracts semantic article/post structures and returns normalized JSON.

The collector intentionally does not implement CAPTCHA bypass, fingerprint evasion, access-control bypass or credential export.

### `DeviceCredentialStore`

Stores the **MR SCRAP backend device bearer token** using AES-GCM with a non-exportable AndroidKeyStore key. This credential is unrelated to Facebook authentication.

The token is not stored in WorkManager `Data` and Android application backup is disabled.

### `AuthenticatedSourceWorker`

WorkManager worker for best-effort periodic checks. It:

1. validates source/backend URLs;
2. confirms the local Facebook session;
3. collects normalized posts;
4. reads the user-bound MR SCRAP bearer credential from `DeviceCredentialStore`;
5. sends normalized posts to `/api/device/ingest` over HTTPS.

Android WorkManager does not guarantee exact run times. Current minimum periodic interval is 15 minutes.

## 6. Backend components

### HTTP/API — `server.ts`

Responsibilities:

- application registration/login/logout/session checks;
- tenant authentication and authorization;
- strict credentialed CORS policy;
- URL/input validation;
- alpha single-process rate limiting;
- user-bound device credential registration/authentication;
- source/rule/alert CRUD;
- real monitoring scan dispatch;
- AI utility routes;
- production startup validation.

Production fails closed when PostgreSQL or required AI configuration is missing/unusable at startup.

### Application auth — `server/auth/appAuth.ts`

Responsibilities:

- normalize/validate email and password input;
- scrypt password hashing/verification;
- create opaque application sessions;
- store only session-token hashes;
- emit/clear HttpOnly session cookie;
- `requireAppAuth` middleware;
- logout/session revocation.

### Device auth — `server/auth/deviceAuth.ts`

Responsibilities:

- require an authenticated MR SCRAP user for device registration;
- generate a separate opaque device token;
- store only device-token hash;
- bind device to application `user_id`;
- authenticate `/api/device/ingest`;
- revoke user devices on logout/revocation.

### Persistence — `server/db/*`

PostgreSQL tables:

- `users`
- `app_sessions`
- `devices`
- `sources`
- `rules`
- `rule_sources`
- `posts`
- `matches`
- `notifications`
- `connector_events`

Important integrity constraints:

- application email unique case-insensitively;
- application session token hash unique;
- source identity unique per user/platform/external source ID;
- backend device token hash unique;
- post fingerprint unique;
- match unique per `(rule_id, post_id)`.

Persisted post fingerprints are source-scoped (`sourceId:contentFingerprint`) so the same public post monitored by different users/sources cannot suppress another user's processing.

### Device ingestion — `server/worker/deviceIngestion.ts`

Pipeline:

```text
Authenticated device request
→ device token → userId
→ source must belong to that userId
→ validate post origin
→ sanitize data
→ canonicalize URL
→ source-scoped fingerprint
→ atomic DB dedupe
→ evaluate active tenant rules
→ persist unique match
→ create notification record
```

### Server monitoring worker

`server/worker/monitoringWorker.ts` is for optional server-side connectors only. It intentionally skips `device_session` sources; those must arrive through device ingestion so the social session never moves to the server.

## 7. Tenant-isolation verification

Automated integration coverage starts a real local HTTP server and verifies:

```text
anonymous request → private sources denied
user A creates source A
user B list → source A absent
user B delete/pause source A → denied
user B rule bound to source A → denied
user B device token ingest to source A → denied
user A logout → old app session denied
user A logout → old device token denied
```

This test protects the API authorization boundary independently from frontend behavior.

## 8. AI architecture

Business logic depends on an `AIProvider` abstraction, not a vendor SDK.

```text
Operator environment
  │
  ├─ AI_BASE_URL
  ├─ AI_API_KEY
  ├─ AI_MODEL
  └─ AI_API_FORMAT
       │
       ▼
providerFactory
  ├─ OpenAI Chat adapter
  ├─ OpenAI Responses adapter
  └─ Gemini Native adapter
       │
       ▼
OperatorAIService
       │
       ▼
Rule evaluator / digest / preview / suggestions
```

Supported formats:

- `openai_chat`
- `openai_responses`
- `gemini_native`

Remote provider URLs require HTTPS in production.

The AI result for rule matching is normalized to:

```json
{
  "matched": true,
  "confidence": 0.94,
  "category": "discount",
  "reason": "The post announces a qualifying discount.",
  "extracted": {}
}
```

Production never converts an AI provider failure into a fabricated positive match.

## 9. Deduplication

Priority:

1. external platform post ID;
2. canonical social post URL;
3. normalized content hash fallback.

Canonicalization:

- removes known tracking/noise parameters;
- preserves identity-bearing parameters such as Facebook `story_fbid` and `id`;
- normalizes equivalent bare/mobile/web Facebook hosts to a stable host form;
- normalizes the bare Instagram host similarly.

The content fingerprint is prefixed with `source.id` before persistence to prevent cross-source/cross-user suppression while preserving one atomic database uniqueness constraint.

## 10. Notification architecture

Current state:

```text
Match
→ durable notification row
→ in-app alert
```

Interfaces for Web Push and FCM exist, but external delivery deliberately reports itself as not configured until subscription/device-token persistence and real dispatch are implemented.

## 11. Optional public provider

Authenticated Android monitoring is primary.

A server-side public provider may be explicitly enabled by the operator:

```env
PUBLIC_PROVIDER=apify
APIFY_API_TOKEN=...
```

It is optional and must never become an implicit fallback that fabricates activity.

## 12. Runtime modes

### `APP_MODE=production`

- PostgreSQL required.
- AI provider required.
- no fake posts/source metadata/matches.
- no local JSON DB fallback.
- remote AI provider requires TLS.
- application sessions and user-bound device authorization persist in PostgreSQL.

### `APP_MODE=demo`

Demo/seed content is allowed for product demonstration and automated isolated tests only. It must remain explicitly separated from real monitoring.

## 13. Remaining launch risks

The application/tenant boundary is implemented and tested. Remaining production risks are now primarily runtime/platform/release concerns:

- physical Android verification of the MR SCRAP credential-cookie flow;
- physical Facebook WebView login acceptance;
- live Facebook DOM collector compatibility;
- Instagram authenticated flow validation;
- real FCM/Web Push delivery if required at launch;
- email verification/password reset/account recovery;
- Play Store signing/release pipeline;
- distributed rate limiting/observability before horizontal scaling.

The Draft PR must remain unmerged as “production ready” until the physical acceptance protocol and final candidate CI/security review pass.
