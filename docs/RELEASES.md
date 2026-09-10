# Releases — MR SCRAP

## Release levels

MR SCRAP intentionally separates **validation artifacts**, controlled Android alpha distribution and future production releases.

Current validation/evidence is on `test/android-headless-emulator-20260909` (Draft PR #7, **DO NOT MERGE AS-IS**). The protected `work/real-session-ai-provider` lane remains separate and owner-blocked unless its Production/provider scope is explicitly reopened.

## 1. Validation CI artifact

Primary executable validation workflow for the current evidence lane:

`.github/workflows/code-complete-gate.yml`

It verifies:

1. locked dependency installation with `npm ci`;
2. TypeScript typecheck;
3. unit/integration/regression tests;
4. web/server build;
5. Capacitor Android sync;
6. Android debug APK compilation;
7. APK artifact upload.

Properties:

- temporary/short-lived;
- useful for branch validation;
- debug signed;
- compile/build verification only unless a real HTTPS backend origin is explicitly built into a physical acceptance candidate;
- not a production distribution channel.

A validation APK built with `https://example.invalid` cannot perform a real end-to-end backend acceptance test.

The generic `.github/workflows/verify-real-session.yml` workflow remains available for manual/general verification. Its automatic PR job is intentionally skipped on the current validation lane and protected provider lane because hosted runs on this repository were failing before runner assignment and duplicated the self-hosted Code Complete workload.

## 2. Physical acceptance candidate

The physical acceptance path is separate from ordinary compile artifacts.

Use the manual **Android Physical ADB Final Gate** only after a real external device-state change produces exactly one authorized physical Android target.

The gate must:

- preserve the currently installed app/session state;
- refuse to proceed if the expected Facebook session marker is absent;
- verify candidate and installed APK signing certificates are compatible;
- use `adb install -r` for replacement only after compatibility is proven;
- never uninstall or clear app/WebView/Facebook data merely to update the candidate;
- fail closed rather than destroy the evidence state;
- prove the real collector boundary without logging source/session secrets.

A successful automated physical gate is a prerequisite/collector proof. It does **not** replace the complete manual acceptance matrix in `docs/ANDROID_ACCEPTANCE_TEST.md`.

## 3. Android Alpha prerelease

Workflow:

`.github/workflows/android-alpha-release.yml`

This is a separate controlled distribution path and is **outside the current PR #7 validation authority**.

Mutable prerelease tag:

```text
android-alpha
```

Release title:

```text
MR SCRAP Android Alpha
```

Expected assets when that lane is explicitly used:

```text
MR-SCRAP-android-alpha.apk
MR-SCRAP-android-alpha.apk.sha256
COMMIT_SHA.txt
```

The alpha channel is intended for controlled testing and is not Play Store production signing.

### Automatic branch publishing

The existing alpha workflow can use repository variable:

```text
ALPHA_API_BASE_URL=https://your-real-backend.example
```

for its configured alpha branch path. Do not trigger, reconfigure or treat that path as authorized from the PR #7 validation lane.

If no real HTTPS backend origin is configured, the alpha workflow must skip/fail closed rather than publish a knowingly unusable acceptance build.

### Manual alpha publishing

When explicitly authorized, the **Publish Android Alpha** workflow accepts a real HTTPS backend base URL.

Production/provider/secrets scope remains separate from validation work.

## 4. Checksum verification

Alpha/release artifacts should include a SHA-256 digest.

Linux/macOS:

```bash
sha256sum -c MR-SCRAP-android-alpha.apk.sha256
```

PowerShell example:

```powershell
Get-FileHash .\MR-SCRAP-android-alpha.apk -Algorithm SHA256
```

`COMMIT_SHA.txt` should record the source commit used for the APK.

## 5. Alpha/debug is not production

Current validation/alpha APKs are **debug builds**.

They must not be presented as:

- Play Store production signed;
- security-reviewed final release;
- production-ready multi-user distribution;
- evidence that the complete physical Facebook/Instagram acceptance matrix passed.

## 6. Clean promotion after physical PASS

PR #7 is intentionally an evidence lane with substantial historical diagnostics/probes and an alpha/debug-only test keystore. **Do not merge PR #7 as-is**, even after physical acceptance succeeds.

After the P0 physical matrix passes:

1. preserve PR #7 as evidence;
2. create a clean promotion branch from the then-current `main`;
3. promote only intended product/server/Android/docs/tests plus minimal permanent CI;
4. exclude obsolete diagnostic/probe/apply workflows/scripts;
5. exclude the alpha/debug-only test keystore from the production/main promotion path;
6. rerun the complete Code Complete Gate on the clean tree;
7. perform focused security/data-flow review;
8. only then consider merge and release progression.

## 7. Future stable release process

Stable releases should use immutable semantic-version tags, for example:

```text
v1.0.0
v1.0.1
```

A future production release workflow should require all of the following before creating the tag/release:

- clean promotion candidate merged only after P0 launch gates;
- full user authentication and tenant isolation;
- physical Android acceptance protocol passed;
- real FCM/push behavior either implemented or external-push claims kept out of product copy;
- production Android keystore/signing configured through secure CI secrets;
- release build (`assembleRelease`/AAB), not debug APK;
- versionCode/versionName policy enforced;
- Play Store/privacy declarations completed;
- tests/CI green on the exact release source;
- backend migration/API compatibility reviewed;
- release notes and rollback target recorded.

## 8. Signing keys

Never commit or expose **production** signing material.

Future release signing secrets should be stored in an appropriate CI secret manager/GitHub Actions secrets and materialized only during the release job.

Never commit production:

- `.jks` / keystore files;
- signing passwords;
- service-account private keys;
- environment `.env` files.

The PR #7 validation branch currently contains an alpha/debug-only test keystore used solely to preserve sideload signature continuity across non-destructive `adb install -r` acceptance updates. It is **not** a production key and must be excluded from clean promotion/main and never reused for Play signing.

## 9. Backend compatibility

Android builds compile `VITE_API_BASE_URL` into the frontend bundle. Before distributing an APK for real acceptance/release:

1. confirm that backend URL is final for the intended environment;
2. confirm HTTPS certificate is valid;
3. confirm backend API contract matches the APK commit;
4. confirm CORS allows the Capacitor origin;
5. confirm PostgreSQL migrations are applied;
6. confirm centrally managed AI configuration is healthy when that acceptance row requires it.

Do not expose provider credentials in Android/frontend bundles.

## 10. Dependency / CI provenance

The validation lane uses a committed `package-lock.json`, `npm ci` and reviewed immutable GitHub Action commit SHAs in permanent gates.

Current audit state recorded in PR #7:

- 0 critical vulnerabilities;
- 0 high vulnerabilities;
- 5 moderate residual advisories.

A guarded non-forced lockfile-only audit remediation made no supported change. Do not use unsupported overrides/downgrades or a framework/server-major migration merely to make audit output cosmetically green on the validated lane. Reassess residuals on the clean promotion/dependency-upgrade path.

## 11. Rollback

For controlled alpha testing, keep the prior known-good APK/commit available until the next candidate passes acceptance testing.

For future stable releases:

- stable tags must never be force-moved;
- use a new patch release for rollback/fix-forward when possible;
- verify DB backward compatibility before deploying an older backend;
- record both Android and backend commit SHA in release evidence.

## 12. Current release gate

Do not promote any alpha/debug artifact to a stable release until P0 blockers in `PRODUCTION_STATUS.md` are closed, a clean promotion candidate has passed full CI/security review, and production signing/distribution is explicitly authorized.
