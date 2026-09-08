import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Android release middleware is wired before JSON body parsing', () => {
  const server = read('server.ts');
  const releaseIndex = server.indexOf('handleReleasePreRoute(req, res, next)');
  const jsonIndex = server.indexOf("app.use(express.json({ limit: '1mb' }))");
  assert.ok(releaseIndex >= 0, 'release pre-route must be registered');
  assert.ok(jsonIndex >= 0, 'JSON parser must be present');
  assert.ok(releaseIndex < jsonIndex, 'binary release route must run before JSON parsing');
});

test('Smart Explore is device-authenticated and hypothetical activity preview is disabled', () => {
  const server = read('server.ts');
  const exploreStart = server.indexOf("app.post('/api/device/explore'");
  assert.ok(exploreStart >= 0, 'device explore route must exist');
  assert.ok(server.slice(exploreStart, exploreStart + 250).includes('requireDeviceAuth'), 'device explore route must require device auth');
  assert.match(server, /Hypothetical activity previews are disabled/);
});

test('source deletion protects against accidental global rules', () => {
  const server = read('server.ts');
  assert.match(server, /deleteOwnedSourceSafely/);
  assert.match(server, /sourceIds\.includes\(sourceId\)\s*&&\s*sourceIds\.length\s*===\s*1/);
});

test('native collector supports bounded multi-post collection', () => {
  const collector = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java');
  assert.match(collector, /MAX_LIMIT\s*=\s*20/);
  assert.match(collector, /window\.scrollBy/);
  assert.match(collector, /posts\.slice\(0,LIMIT\)/);
});

test('rate limiting trusts one production proxy hop and isolates route buckets', () => {
  const server = read('server.ts');
  assert.match(server, /app\.set\('trust proxy', APP_MODE === 'production' \? 1 : false\)/);
  assert.match(server, /const bucket = `rl_\$\{\+\+rateLimiterSequence\}`/);
  assert.match(server, /const key = `\$\{bucket\}:\$\{ip\}`/);
  assert.doesNotMatch(server, /rateLimitMap\.get\(ip\)/);
});

test('source list exposes exact persisted post counts', () => {
  const database = read('server/db/database.ts');
  assert.match(database, /COUNT\(\*\)::int FROM posts p WHERE p\.source_id = s\.id/);
  assert.match(database, /AS "recentPostsCount"/);
});

test('a successful empty initial device scan still updates source health', () => {
  const radar = read('src/context/RadarContext.tsx');
  assert.doesNotMatch(radar, /if \(posts\.length === 0\) return;/);
  assert.match(radar, /apiIngestDevicePosts\(persistedSource\.id, posts, locale\)/);
});

test('device session status is reconciled after persisted source hydration', () => {
  const radar = read('src/context/RadarContext.tsx');
  assert.match(radar, /await loadDatabaseState\(\);\s*await refreshDeviceSession\(\)/s);
  assert.match(radar, /DeviceSessionConnector\.isPlatformConnected\(status, source\.platform\)/);
  assert.match(radar, /connectorStatus:[\s\S]*'authenticated_monitoring'[\s\S]*'needs_relogin'/);
});

test('PostgreSQL match conflicts return the persisted winner instead of the losing candidate', () => {
  const database = read('server/db/database.ts');
  assert.match(database, /ON CONFLICT \(rule_id, post_id\) DO NOTHING RETURNING \*/);
  assert.match(database, /SELECT \* FROM matches WHERE rule_id = \$1 AND post_id = \$2 LIMIT 1/);
  assert.match(database, /Match conflict occurred but the persisted match could not be loaded/);
});

test('background device ingestion preserves app locale end to end', () => {
  const connector = read('src/connectors/deviceSessionConnector.ts');
  const plugin = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java');
  const worker = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceWorker.java');
  const radar = read('src/context/RadarContext.tsx');
  assert.match(connector, /locale: 'ar' \| 'en'/);
  assert.match(plugin, /KEY_LOCALE/);
  assert.match(worker, /public static final String KEY_LOCALE = "locale"/);
  assert.match(worker, /payload\.put\("locale", locale\)/);
  assert.match(radar, /scheduleBackgroundSource\(persistedSource, backendBaseUrl, locale\)/);
});

test('intentional platform disconnect cancels scheduled source work and reconnect reschedules it', () => {
  const settings = read('src/screens/SettingsScreen.tsx');
  assert.match(settings, /cancelPlatformSources\(platform\)/);
  assert.match(settings, /schedulePlatformSources\(platform\)/);
  assert.match(settings, /Promise\.allSettled/);
});

test('Meta login WebViews detach from their parent before destroy', () => {
  for (const file of ['FacebookSessionActivity.java', 'InstagramSessionActivity.java']) {
    const activity = read(`android/app/src/main/java/com/mrscrap/socialradar/${file}`);
    const removeIndex = activity.indexOf('removeView(webView)');
    const destroyIndex = activity.indexOf('webView.destroy()');
    assert.ok(removeIndex >= 0 && destroyIndex > removeIndex, `${file} must detach before destroy`);
  }
});

test('anonymous public bootstrap does not request authenticated radar CRUD', () => {
  const radar = read('src/context/RadarContext.tsx');
  const authGuard = radar.indexOf('if (!auth.authenticated || !auth.user)');
  const privateFetch = radar.indexOf('apiFetchSources()', authGuard);
  assert.ok(authGuard >= 0, 'authenticated bootstrap guard must exist');
  assert.ok(privateFetch > authGuard, 'private source/rule/alert fetches must occur only after auth guard');
  assert.match(radar, /extractSupportedSocialUrl/);
});

test('shared URL onboarding accepts only supported Facebook and Instagram URLs', () => {
  const helper = read('src/lib/socialUrl.ts');
  const app = read('src/App.tsx');
  assert.match(helper, /FACEBOOK_HOSTS/);
  assert.match(helper, /INSTAGRAM_HOSTS/);
  assert.match(helper, /parsed\.protocol !== 'https:' && parsed\.protocol !== 'http:'/);
  assert.match(app, /extractSupportedSocialUrl/);
  assert.doesNotMatch(app, /sharedUrl\.startsWith\('http'\)/);
});

test('Android updater is backend-origin pinned and validates APK identity before installer', () => {
  const update = read('src/services/appUpdate.ts');
  const plugin = read('android/app/src/main/java/com/mrscrap/socialradar/AppUpdatePlugin.java');
  const verifier = read('android/app/src/main/java/com/mrscrap/socialradar/ApkIdentityVerifier.java');
  assert.match(update, /url\.origin !== backendOrigin\.origin/);
  const verifyIndex = plugin.indexOf('ApkIdentityVerifier.verify');
  const installerIndex = plugin.indexOf('FileProvider.getUriForFile');
  assert.ok(verifyIndex >= 0 && installerIndex > verifyIndex, 'APK identity verification must happen before installer launch');
  assert.match(verifier, /context\.getPackageName\(\)\.equals\(archive\.packageName\)/);
  assert.match(verifier, /archiveCode != expectedVersionCode/);
  assert.match(verifier, /archiveCode <= installedCode/);
  assert.match(verifier, /!installedSigners\.equals\(archiveSigners\)/);
});

test('mandatory updater follows the stored app locale when available', () => {
  const gate = read('src/components/ForceUpdateGate.tsx');
  assert.match(gate, /const LOCALE_KEY = 'mrscrap_locale_v2'/);
  assert.match(gate, /localStorage\.getItem\(LOCALE_KEY\)/);
});
