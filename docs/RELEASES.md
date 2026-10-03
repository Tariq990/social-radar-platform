# Releases — MR SCRAP

## Release levels

MR SCRAP intentionally separates CI artifacts, Android alpha builds and future production releases.

## 1. Pull-request CI artifact

Workflow:

`.github/workflows/verify-real-session.yml`

For the architecture PR, CI verifies:

1. dependency installation;
2. TypeScript typecheck;
3. unit tests;
4. web/server build;
5. Capacitor Android sync;
6. Android debug APK compilation.

The resulting debug APK is uploaded as a GitHub Actions artifact.

Properties:

- temporary/short-lived;
- useful for branch testing;
- debug signed;
- backend origin comes from the CI build environment;
- not a production distribution channel.

A CI APK built with `https://example.invalid` is compile verification only and cannot perform a real end-to-end backend acceptance test.

## 2. Android Alpha prerelease

Workflow:

`.github/workflows/android-alpha-release.yml`

Mutable prerelease tag:

```text
android-alpha
```

Release title:

```text
MR SCRAP Android Alpha
```

Expected assets:

```text
MR-SCRAP-android-alpha.apk
MR-SCRAP-android-alpha.apk.sha256
COMMIT_SHA.txt
```

This release is intended for controlled physical-device acceptance testing.

### Automatic branch publishing

Configure the repository Actions variable:

```text
ALPHA_API_BASE_URL=https://your-real-backend.example
```

Pushes to:

```text
work/real-session-ai-provider
```

can then build an alpha APK using that backend origin and update the mutable `android-alpha` prerelease.

If `ALPHA_API_BASE_URL` is not configured, the automatic push release job is deliberately skipped so GitHub does not publish a knowingly broken APK.

### Manual alpha publishing

Run the **Publish Android Alpha** workflow manually and provide:

```text
backend_base_url=https://your-real-backend.example
```

The URL must use HTTPS.

## 3. Checksum verification

The alpha workflow creates a SHA-256 file.

Linux/macOS:

```bash
sha256sum -c MR-SCRAP-android-alpha.apk.sha256
```

PowerShell example:

```powershell
Get-FileHash .\MR-SCRAP-android-alpha.apk -Algorithm SHA256
```

Compare the output with the digest in `MR-SCRAP-android-alpha.apk.sha256`.

`COMMIT_SHA.txt` records the source commit used for the APK.

## 4. Alpha is not production

The current alpha APK is a **debug build** using Android's standard debug signing. The pre-publication repository alpha key is retired and is not used by current builds.

It must not be presented as:

- Play Store production signed;
- security-reviewed final release;
- production-ready multi-user app;
- evidence that the physical Facebook session acceptance test passed.

The alpha channel exists to test that flow.

## 5. Future stable release process

Stable releases should use immutable semantic-version tags, for example:

```text
v1.0.0
v1.0.1
```

A future production release workflow should require all of the following before creating the tag/release:

- architecture PR merged after P0 launch gates;
- full user authentication and tenant isolation;
- physical Android acceptance protocol passed;
- real FCM/push behavior either implemented or claims removed;
- production Android keystore/signing configured through secure CI secrets;
- release build (`assembleRelease`/AAB), not debug APK;
- versionCode/versionName bump;
- Play Store/privacy declarations completed;
- tests/CI green;
- backend migration compatibility reviewed;
- release notes and rollback target recorded.

## 6. Signing keys

Do not commit signing material to the repository. Current alpha/debug builds use standard Android debug signing only.

The pre-publication alpha signing key is retired and must not be trusted for current or future distribution. Production signing must use a separate protected key and release process.

Future release signing secrets should be stored in an appropriate CI secret manager/GitHub Actions secrets and materialized only during the release job.

Never commit:

- `.jks` / keystore files;
- signing passwords;
- service-account private keys;
- production environment `.env` files.

## 7. Backend compatibility

Android builds compile `VITE_API_BASE_URL` into the frontend bundle. Before distributing an APK:

1. confirm that backend URL is final for the testing/release environment;
2. confirm HTTPS certificate is valid;
3. confirm backend API contract matches the APK commit;
4. confirm CORS allows the Capacitor origin;
5. confirm PostgreSQL migrations are applied;
6. confirm AI provider is configured centrally.

## 8. Rollback

For alpha testing, keep the prior known-good APK/commit available until the next build passes acceptance testing.

For future stable releases:

- stable tags must never be force-moved;
- use a new patch release for rollback/fix-forward when possible;
- verify DB backward compatibility before deploying an older backend;
- record both Android and backend commit SHA in release evidence.

## 9. Current release gate

Do not promote `android-alpha` to a stable release until P0 blockers in `PRODUCTION_STATUS.md` are closed.
