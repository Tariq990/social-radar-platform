# MR SCRAP — Production Architecture Status

This document describes the current implementation on the real-session architecture branch.

## Primary monitoring path

Authenticated Facebook monitoring is device-owned:

1. Android opens the real Facebook site in a dedicated WebView.
2. WebView/CookieManager retains the user's authenticated browser session locally.
3. The native collector loads watched URLs with that local session.
4. The collector emits normalized post metadata only.
5. Normalized data is POSTed to `/api/device/ingest`.
6. Backend deduplicates, persists, evaluates rules through the configured AI provider, and creates matches.

Raw Facebook passwords/cookies are not part of the JavaScript bridge or backend ingestion contract.

The collector does not bypass access controls, CAPTCHA, or platform restrictions. DOM changes or platform restrictions can make a source temporarily unavailable.

## AI provider

The AI vendor/model is controlled by the application operator, not end users.

Required production configuration:

```env
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_API_FORMAT=openai_chat
AI_PROVIDER_NAME=Configured AI
```

Supported formats:

- `openai_chat`
- `openai_responses`
- `gemini_native`

Business logic calls the provider-neutral AI service. Provider failure does not create a fabricated match.

## Persistence

`APP_MODE=production` requires a working `DATABASE_URL`. If PostgreSQL is unavailable, production startup fails clearly instead of silently switching to the local JSON store.

Local JSON persistence is development/demo-only.

## Android background behavior

Authenticated periodic checks use Android WorkManager. Android controls exact scheduling and does not guarantee real-time execution. Current minimum periodic interval is 15 minutes.

A faster future foreground-service mode would have battery and persistent-notification implications and is not claimed as implemented.

## Optional public provider

Apify is not required and is not the primary architecture. It can only be enabled explicitly by the operator:

```env
PUBLIC_PROVIDER=apify
APIFY_API_TOKEN=...
```

Leaving these empty keeps monitoring on the authenticated Android device path.

## Android backend origin

Bundled Android builds need the public backend origin at build time:

```env
VITE_API_BASE_URL=https://api.example.com
```

Same-origin web deployments may leave it empty.

## Notification status

Matches create durable in-app notification records. Web Push and FCM external delivery are intentionally not marked as delivered until subscription/token registration and real dispatch are implemented.

## Known limitations before a production launch

- Application user authentication is still incomplete; backend currently uses the existing `user_default` development identity.
- `/api/device/ingest` needs authenticated per-device authorization before multi-user production use.
- FCM/Web Push end-to-end delivery is not finished.
- Instagram authenticated login/session handling is not yet independently implemented; the current login flow is Facebook-first.
- Meta DOM changes can break local extraction and require maintenance.
- WorkManager is periodic/best-effort, not guaranteed real-time monitoring.
- Play Store production signing, icons, privacy declarations, and release configuration remain separate release tasks.

## Verification

GitHub Actions workflow `.github/workflows/verify-real-session.yml` checks:

1. dependency installation
2. TypeScript typecheck
3. web/server production bundle
4. Capacitor Android sync
5. Android debug compilation

Do not describe the application as production-ready until this workflow is green and the real-device Facebook acceptance flow has been tested on physical Android hardware.
