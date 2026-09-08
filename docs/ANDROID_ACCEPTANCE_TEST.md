# Android Physical-Device Acceptance Test

This test is a **required P0 launch gate** for the authenticated Facebook monitoring architecture.

Passing CI/Gradle compilation is not enough. The following flow must be verified on a real Android device against a real deployed backend.

## Preconditions

Before testing, confirm:

- Android device has a current Android System WebView/Chrome implementation.
- A real HTTPS backend is deployed and reachable from the phone.
- `APP_MODE=production` on the backend.
- PostgreSQL is reachable through `DATABASE_URL`.
- The centrally configured AI provider is reachable through `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_API_FORMAT`.
- The APK was compiled with:

```env
VITE_API_BASE_URL=https://your-real-backend.example
```

- Tester uses a Facebook account they are authorized to use.
- At least one Facebook page/source is available for the test.

Do not use a CI APK built with `https://example.invalid` for this acceptance test.

---

## Test record

Record these values before starting:

| Field | Value |
|---|---|
| Date/time | |
| Android device/model | |
| Android version | |
| Android System WebView version | |
| APK commit SHA | |
| Backend deployment SHA | |
| Backend URL | |
| AI provider format/model | |
| Tester | |

---

## A. Installation / backend connectivity

1. Install the current alpha APK.
2. Launch MR SCRAP.
3. Confirm the application loads without a blank screen/crash.
4. Confirm backend status becomes online.
5. Confirm production mode does not display seeded demo alerts.
6. Confirm the backend health endpoint reports PostgreSQL and configured AI successfully.

**Pass:** app launches and talks to the configured HTTPS backend.

**Fail:** app uses a placeholder backend, silently enters demo mode, or crashes.

---

## B. Facebook login

1. Open **Settings → Connect Facebook**.
2. Confirm the dedicated WebView opens Facebook's real domain.
3. Enter Facebook credentials directly into Facebook's page.
4. Complete any normal Facebook login verification required by the account.
5. Tap **Done** only after login completes.
6. Confirm MR SCRAP reports the Facebook session as connected.

### Security observation

During this step verify:

- MR SCRAP does not show a custom password form.
- no password value appears in application logs.
- no raw Facebook cookie is copied into the React UI.

**Pass:** Facebook's own page accepts login and MR SCRAP detects the authenticated session.

**Fail:** WebView login is blocked, session detection never succeeds, or credentials are exposed to app/backend logging.

---

## C. Session persistence

1. Force-close MR SCRAP.
2. Reopen it.
3. Confirm Facebook session still reports connected.
4. Reboot the Android device.
5. Reopen MR SCRAP.
6. Confirm the session is still usable if Facebook has not independently expired it.

**Pass:** normal app/device restart does not force unnecessary re-login.

**Fail:** session disappears immediately after app restart without Facebook invalidating it.

---

## D. Android Share Target

1. Open Facebook on the test device.
2. Choose a real Facebook page/post.
3. Tap **Share**.
4. Select **MR SCRAP**.
5. Confirm MR SCRAP opens and receives the real shared URL/text.
6. Confirm the Add Source flow opens with the shared target.

Repeat with at least:

- Facebook page URL;
- Facebook post URL;
- Facebook `story.php?story_fbid=...&id=...` style URL if available.

**Pass:** shared links arrive intact, including identity-bearing query parameters.

**Fail:** URL is missing, corrupted, or identity parameters are stripped.

---

## E. Real source resolution

1. Resolve the shared source while Facebook session is connected.
2. Confirm displayed source name matches the real page/account.
3. Confirm avatar/handle are real when available.
4. Confirm the stored source has a real `externalId`/handle rather than a generated placeholder.
5. Confirm no Unsplash/demo avatar is substituted in production.

**Pass:** source metadata originates from the real loaded page/source.

**Fail:** fabricated metadata is shown or production silently falls back to demo content.

---

## F. Rule creation

Create a deterministic test rule, for example:

```text
Notify me when this page posts about TEST_KEYWORD_12345.
```

Use a source/post you control when possible so a matching test post can be created safely.

Confirm:

- source persists in PostgreSQL;
- rule persists in PostgreSQL;
- restarting the app does not remove either record.

---

## G. Real post collection

1. Trigger **Scan Now** / initial collection.
2. Confirm the Android collector loads the watched source with the local Facebook session.
3. Confirm extracted posts correspond to real posts visible on the source.
4. Check normalized payload fields when available:
   - real post URL;
   - external post ID/shortcode when available;
   - text/caption;
   - author/source metadata;
   - publish timestamp if the page exposes it;
   - media URLs if exposed.
5. Confirm an unavailable timestamp remains unknown rather than being invented as “now”.

**Pass:** backend receives real normalized post metadata.

**Fail:** random/fake posts appear, or unavailable values are fabricated.

---

## H. Privacy / network boundary

Inspect Android/network/backend logs during collection.

The request to `/api/device/ingest` must **not** contain:

- Facebook password;
- `Cookie` header containing Facebook session values;
- `c_user`;
- `xs`;
- Facebook session/token export;
- raw WebView cookie dump.

The request **should** contain the separate MR SCRAP backend bearer token in the Authorization header.

Confirm the backend stores only the SHA-256 digest of that MR SCRAP device token.

**Pass:** social session material stays on device.

**Fail:** any Facebook authentication secret reaches the backend.

---

## I. Deduplication

1. Run collection once.
2. Record accepted post count and resulting alerts.
3. Immediately run collection again without creating new social posts.
4. Confirm the second run reports those posts as duplicates/no new posts.
5. Confirm no duplicate alert is created for the same `(rule, post)` pair.
6. Repeat using a Facebook query-based post URL to confirm `story_fbid` identity is preserved.

**Pass:** repeated scans are idempotent.

**Fail:** same real post generates duplicate DB rows or alerts.

---

## J. AI matching

### Negative case

1. Use a real post that does not satisfy the watch rule.
2. Confirm it is persisted as a post if new.
3. Confirm no positive match/alert is created.

### Positive case

1. Publish or select a real post that satisfies the watch rule.
2. Collect it.
3. Confirm configured AI provider is called.
4. Confirm a structured result is recorded.
5. Confirm one match appears in Alerts/Radar.
6. Confirm confidence threshold is honored.

### Provider failure case

1. In a controlled test environment, temporarily make the AI provider unavailable.
2. Collect a new candidate post.
3. Confirm MR SCRAP records an AI evaluation error.
4. Confirm it does **not** manufacture a successful match.

---

## K. Background WorkManager monitoring

1. Ensure source monitoring is enabled.
2. Close MR SCRAP normally.
3. Keep network available.
4. Wait at least one Android WorkManager scheduling interval (current minimum: 15 minutes; actual run may be later).
5. Create a new matching source post during the observation window if you control the source.
6. Confirm background collection eventually checks the source and updates backend state.
7. Confirm the worker reads its MR SCRAP backend credential from AndroidKeyStore-backed storage and does not persist it in WorkManager input data.

Also test:

- temporary network loss;
- Android battery saver;
- device reboot where practical.

**Pass:** best-effort background checking resumes without pretending to provide exact real-time scheduling.

---

## L. Session expiry / reconnect

1. Invalidate the Facebook session (logout from the WebView or invalidate the account session through normal Facebook controls).
2. Run a source check.
3. Confirm MR SCRAP reports re-login/reconnect required instead of fake successful monitoring.
4. Reconnect through the real Facebook WebView.
5. Confirm monitoring can resume.

---

## M. Disconnect privacy test

1. In MR SCRAP choose **Disconnect Facebook**.
2. Confirm WorkManager jobs for authenticated sources are cancelled.
3. Confirm Facebook WebView cookies are cleared.
4. Reopen the Connect Facebook screen.
5. Confirm the previous Facebook authenticated session is no longer available.

**Pass:** Disconnect genuinely removes the local Facebook session.

---

## N. Source pause/delete

1. Pause a monitored source.
2. Confirm its background work is cancelled/disabled.
3. Resume it and confirm periodic work can be scheduled again.
4. Delete the source.
5. Confirm associated scheduled work is cancelled and backend source data is removed according to DB cascade behavior.

---

## Acceptance matrix

| Gate | Result | Evidence / notes |
|---|---|---|
| App installs/launches | ⬜ | |
| Real HTTPS backend | ⬜ | |
| Facebook WebView login works | ⬜ | |
| Session survives restart | ⬜ | |
| Share Target works | ⬜ | |
| Real source metadata | ⬜ | |
| Real posts extracted | ⬜ | |
| No Facebook secrets leave device | ⬜ | |
| PostgreSQL persistence | ⬜ | |
| Dedupe/idempotency | ⬜ | |
| Negative AI case | ⬜ | |
| Positive AI case | ⬜ | |
| AI failure does not fake match | ⬜ | |
| WorkManager background check | ⬜ | |
| Session expiry/reconnect | ⬜ | |
| Disconnect clears Facebook session | ⬜ | |

## Release decision

The physical Android acceptance gate is **PASS** only when every required row above has evidence.

A green GitHub Actions build is necessary but does not substitute for this test.
