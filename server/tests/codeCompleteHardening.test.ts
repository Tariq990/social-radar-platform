import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('production UI does not expose raw render exception details', () => {
  const boundary = read('src/components/ErrorBoundary.tsx');
  assert.match(boundary, /import\.meta\.env\.DEV && this\.state\.error/);
  const rawMessage = boundary.indexOf('{this.state.error.message}');
  const devGate = boundary.indexOf('import.meta.env.DEV && this.state.error');
  assert.ok(devGate >= 0 && rawMessage > devGate, 'raw render diagnostics must stay behind the DEV gate');
});

test('production API redacts unexpected internal errors while preserving explicit validation errors', () => {
  const server = read('server.ts');
  assert.match(server, /function errorMessage\(error: any\): string/);
  assert.match(server, /if \(APP_MODE !== 'production' \|\| allowed\.has\(message\)\) return message \|\| fallback;/);
  assert.doesNotMatch(server, /function safeError\(error: any\): string \{\s*return error\?\.message/s);
  assert.match(server, /REGISTER_PUBLIC_ERRORS\.has\(errorMessage\(error\)\)/);
  assert.match(server, /res\.status\(expected \? 400 : 503\)/);
  assert.match(server, /LOGIN_PUBLIC_ERRORS\.has\(errorMessage\(error\)\)/);
  assert.match(server, /res\.status\(expected \? 401 : 503\)/);
  assert.match(server, /safeError\(error, 'Device ingestion failed', INGEST_PUBLIC_ERRORS\)/);
  assert.match(server, /safeError\(error, 'Explore analysis unavailable', EXPLORE_PUBLIC_ERRORS\)/);
});

test('production radar state never boots with demo collections and trusts persisted server toggles', () => {
  const radar = read('src/context/RadarContext.tsx');
  assert.match(radar, /const \[collections, setCollections\] = useState<Collection\[]>\(\[\]\)/);
  assert.match(radar, /setCollections\(serverDemo \? INITIAL_COLLECTIONS : \[\]\)/);
  assert.match(radar, /function readStoredLocale\(\): Locale/);
  assert.match(radar, /localStorage\.getItem\(STORAGE_KEYS\.LOCALE\) === 'ar' \? 'ar' : 'en'/);
  assert.match(radar, /function readStoredTheme\(\): 'dark' \| 'light'/);
  assert.match(radar, /const serverEnabled = await apiToggleRule\(ruleId\)/);
  assert.match(radar, /enabled: serverEnabled/);
  assert.doesNotMatch(radar, /connectorStatus:\s*sourceData\.connectorStatus/);

  const deleteFunction = radar.indexOf('const deleteSource = async');
  const serverDelete = radar.indexOf('await apiDeleteSource(sourceId)', deleteFunction);
  const localCancel = radar.indexOf('await DeviceSessionConnector.cancelBackgroundSource(sourceId)', deleteFunction);
  assert.ok(deleteFunction >= 0 && serverDelete > deleteFunction && localCancel > serverDelete, 'authoritative server deletion must happen before local WorkManager cleanup');
});

test('API and Smart Grab responses are bounded, metadata healing propagates safely, and social/media URLs are normalized to HTTPS', () => {
  const api = read('src/services/api.ts');
  const explore = read('src/services/explore.ts');
  const avatar = read('src/components/SourceAvatar.tsx');

  assert.match(api, /MAX_API_RESPONSE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(api, /DEFAULT_API_TIMEOUT_MS = 45_000/);
  assert.match(api, /if \(parsed\.protocol === 'http:'\) parsed\.protocol = 'https:';/);
  assert.match(api, /function safeSocialUrl/);
  assert.match(api, /function normalizeIngestSourceMetadata/);
  assert.match(api, /displayName\.trim\(\)\.slice\(0, 255\)/);
  assert.match(api, /safeHttpsUrl\(raw\.avatarUrl\)/);
  assert.ok(api.includes("raw.handle.trim().replace(/^@/, '').slice(0, 255)"));
  assert.match(api, /sourceMetadata: normalizeIngestSourceMetadata\(data\?\.sourceMetadata\)/);

  assert.match(explore, /MAX_EXPLORE_RESPONSE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(explore, /EXPLORE_TIMEOUT_MS = 180_000/);
  assert.match(explore, /function safeSocialUrl/);
  assert.match(explore, /Explore response contained an invalid post URL/);
  assert.match(explore, /if \(parsed\.protocol === 'http:'\) parsed\.protocol = 'https:';/);

  assert.ok(avatar.includes("/^https:\\/\\//i.test(src.trim())"));
  assert.ok(!avatar.includes("/^https?:\\/\\//i.test(src.trim())"));
});

test('Android updater validates bounded metadata and pins APK downloads to the backend HTTPS origin', () => {
  const update = read('src/services/appUpdate.ts');
  assert.match(update, /MAX_UPDATE_META_BYTES = 64 \* 1024/);
  assert.match(update, /function normalizeDecision/);
  assert.match(update, /value\.channel !== 'android-alpha'/);
  assert.match(update, /value\.versionCode <= installedVersionCode/);
  assert.ok(update.includes("/^[a-f0-9]{64}$/i.test(value.sha256)"));
  assert.ok(update.includes("url.origin !== backendOrigin.origin || url.protocol !== 'https:'"));
});

test('Android background ingestion attaches device authorization only to the build-trusted backend', () => {
  const gradle = read('android/app/build.gradle');
  const worker = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceWorker.java');
  assert.match(gradle, /buildConfigField 'String', 'MR_SCRAP_BACKEND_ORIGIN'/);
  assert.match(gradle, /buildConfig = true/);
  assert.match(worker, /String backendBaseUrl = BuildConfig\.MR_SCRAP_BACKEND_ORIGIN;/);
  assert.doesNotMatch(worker, /String backendBaseUrl = getInputData\(\)\.getString\(KEY_BACKEND_BASE_URL\)/);
  const trustedOrigin = worker.indexOf('BuildConfig.MR_SCRAP_BACKEND_ORIGIN');
  const bearerWrite = worker.indexOf('"Authorization", "Bearer " + authToken');
  assert.ok(trustedOrigin >= 0 && bearerWrite > trustedOrigin, 'the bearer destination must originate from the compiled build configuration');
});

test('Android login WebViews reject non-HTTPS navigation and disable local content access', () => {
  for (const file of [
    'android/app/src/main/java/com/mrscrap/socialradar/FacebookSessionActivity.java',
    'android/app/src/main/java/com/mrscrap/socialradar/InstagramSessionActivity.java'
  ]) {
    const activity = read(file);
    assert.match(activity, /if \(!"https"\.equalsIgnoreCase\(scheme\)\) return true;/);
    assert.match(activity, /settings\.setAllowFileAccess\(false\)/);
    assert.match(activity, /settings\.setAllowContentAccess\(false\)/);
    assert.match(activity, /settings\.setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
    assert.match(activity, /WebView\.setWebContentsDebuggingEnabled\(false\)/);
  }

  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:name="\.FacebookSessionActivity"[\s\S]*android:exported="false"/);
  assert.match(manifest, /android:name="\.InstagramSessionActivity"[\s\S]*android:exported="false"/);
});

test('device ingestion and explore persistence upgrade cleartext media and strip secret-shaped metadata', () => {
  for (const file of ['server/worker/deviceIngestion.ts', 'server/worker/deviceExplore.ts']) {
    const source = read(file);
    assert.match(source, /if \(parsed\.protocol === 'http:'\) parsed\.protocol = 'https:';/);
    assert.match(source, /'cookie', 'cookies', 'password', 'passwd', 'session', 'sessionid'/);
    assert.match(source, /'access_token', 'authorization'/);
  }

  const ingestion = read('server/worker/deviceIngestion.ts');
  assert.match(ingestion, /Match persisted but in-app notification persistence failed/);
  assert.match(ingestion, /sourceMetadata = \{/);
});

test('server-managed monitoring uses a historical baseline and re-evaluates duplicate current posts only for latest-post rules', () => {
  const worker = read('server/worker/monitoringWorker.ts');
  assert.match(worker, /const isInitialBaseline = !source\.last_checked_at/);
  assert.match(worker, /const latestPostRules = sourceRules\.filter\(rule => isLatestPostIntent/);
  assert.match(worker, /latestCandidate: rawIndex === latestCandidateIndex/);
  assert.match(worker, /ingestion: 'server_public_provider'/);
  assert.match(worker, /isInitialBaseline \? latestPostRules : sourceRules/);
  assert.match(worker, /if \(savedPost\.id !== candidatePostId\)[\s\S]*evaluateAndPersistRules\(currentViewPost, latestPostRules/s);
  assert.match(worker, /Provider returned an invalid post URL/);
  assert.doesNotMatch(worker, /await db\.hasPostFingerprint\(fingerprint\)/);
});

test('legacy public client connector is fail-closed instead of fabricating identities or posts', () => {
  const connector = read('src/connectors/publicCloudConnector.ts');
  assert.match(connector, /Client-side public source resolution is disabled/);
  assert.match(connector, /Client-side public monitoring is disabled/);
  assert.doesNotMatch(connector, /Demo post:/);
  assert.doesNotMatch(connector, /Math\.random\(\).*post/i);
});

test('Apify credentials are sent in Authorization headers, never query strings', () => {
  const connector = read('server/connectors/apifyConnector.ts');
  assert.doesNotMatch(connector, /[?&]token=\$\{/);
  assert.ok(connector.includes('Authorization: `Bearer ${token}`'));
});

test('database local cascades match relational ownership semantics and notification timestamps persist', () => {
  const database = read('server/db/database.ts');
  assert.match(database, /this\.memoryStore\.notifications = this\.memoryStore\.notifications\.filter\(notification => !matchIds\.has\(notification\.match_id\)\)/);
  assert.match(database, /this\.memoryStore\.connector_events = this\.memoryStore\.connector_events\.filter\(event => event\.source_id !== id\)/);
  assert.match(database, /INSERT INTO notifications \(id,user_id,match_id,channel,status,payload,sent_at,error,created_at\)/);
  assert.match(database, /full\.sent_at \|\| null, full\.error \|\| null/);
  assert.doesNotMatch(database, /source_name: source\?\.name \|\| 'Monitored Page'/);
});

test('CSP and social URL helpers enforce secure production navigation surfaces', () => {
  const index = read('index.html');
  const social = read('src/lib/socialUrl.ts');
  assert.match(index, /http-equiv="Content-Security-Policy"/i);
  assert.match(index, /default-src 'self'/);
  assert.match(index, /object-src 'none'/);
  assert.match(social, /if \(parsed\.protocol !== 'https:'\) return false/);
  assert.match(social, /if \(parsed\.protocol === 'http:'\) parsed\.protocol = 'https:';/);
});
