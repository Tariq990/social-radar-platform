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
  assert.match(collector, /posts\.slice\(0, LIMIT\)/);
  assert.match(collector, /setOffscreenPreRaster\(true\)/);
  assert.match(collector, /mbasic\.facebook\.com/);
  assert.match(collector, /NO_EXTRACTABLE_POSTS/);
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

test('shared URL entry points accept only Facebook and Instagram links', () => {
  const helper = read('src/lib/socialUrl.ts');
  const app = read('src/App.tsx');
  const radar = read('src/context/RadarContext.tsx');
  assert.match(helper, /FACEBOOK_HOSTS/);
  assert.match(helper, /INSTAGRAM_HOSTS/);
  assert.match(helper, /SOCIAL_HOST_FRAGMENT/);
  assert.match(app, /extractSupportedSocialUrl/);
  assert.match(radar, /extractSupportedSocialUrl/);
  assert.doesNotMatch(radar, /function extractSharedUrl/);
});

test('anonymous landing bootstrap does not fetch private radar resources', () => {
  const radar = read('src/context/RadarContext.tsx');
  const authIndex = radar.indexOf('if (!auth.authenticated || !auth.user)');
  const sourceIndex = radar.indexOf('apiFetchSources()');
  assert.ok(authIndex >= 0, 'anonymous short-circuit must exist');
  assert.ok(sourceIndex > authIndex, 'private source fetch must occur only after authenticated short-circuit');
});

test('Android updater is same-origin and verifies package identity before install', () => {
  const webUpdater = read('src/services/appUpdate.ts');
  const nativeUpdater = read('android/app/src/main/java/com/mrscrap/socialradar/AppUpdatePlugin.java');
  const verifier = read('android/app/src/main/java/com/mrscrap/socialradar/ApkIdentityVerifier.java');
  assert.match(webUpdater, /url\.origin !== backendOrigin\.origin/);
  assert.match(nativeUpdater, /sameHttpsOrigin/);
  assert.match(nativeUpdater, /redirected away from the MR SCRAP backend origin/);
  assert.match(nativeUpdater, /ApkIdentityVerifier\.verify/);
  assert.match(verifier, /getPackageArchiveInfo/);
  assert.match(verifier, /getPackageName\(\)/);
  assert.match(verifier, /getLongVersionCode|versionCode/);
  assert.match(verifier, /signingInfo|signatures/);
});

test('Android updater UI follows stored MR SCRAP locale', () => {
  const gate = read('src/components/ForceUpdateGate.tsx');
  assert.match(gate, /mrscrap_locale_v2/);
  assert.match(gate, /stored === 'ar'/);
  assert.match(gate, /stored === 'en'/);
});

test('initial monitoring snapshot is a baseline except for explicit latest-post rules', () => {
  const ingestion = read('server/worker/deviceIngestion.ts');
  assert.match(ingestion, /const isInitialBaseline = !source\.last_checked_at/);
  assert.match(ingestion, /isInitialBaseline \? latestPostRules : sourceRules/);
  assert.match(ingestion, /latestCandidateInputIndex/);
  assert.match(ingestion, /latestCandidate: rawIndex === latestCandidateIndex/);
});

test('metadata resolver can recover the source profile from a shared post URL', () => {
  const resolver = read('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceMetadataResolver.java');
  assert.match(resolver, /authorHref/);
  assert.match(resolver, /rawMetaTitle\.match/);
  assert.match(resolver, /profileUrl/);
  assert.match(resolver, /profileImage/);
});

test('alpha brand configuration does not advertise unimplemented paid capabilities', () => {
  const brand = read('src/config/brand.ts');
  assert.match(brand, /PLANS_CONFIG = \{\} as const/);
  assert.doesNotMatch(brand, /Instant push notifications|Priority background polling|Export alerts to CSV/);
});

test('duplicate source identities never overwrite the existing source or create an update path', () => {
  const database = read('server/db/database.ts');
  assert.match(database, /ON CONFLICT \(user_id, platform, external_id\) DO NOTHING/);
  assert.match(database, /throw new Error\('SOURCE_ALREADY_EXISTS'\)/);
  assert.doesNotMatch(database, /ON CONFLICT \(user_id, platform, external_id\) DO UPDATE SET/);
});

test('authenticated ingestion can repair placeholder source names and missing avatars', () => {
  const database = read('server/db/database.ts');
  const ingestion = read('server/worker/deviceIngestion.ts');
  const radar = read('src/context/RadarContext.tsx');
  assert.match(database, /async updateSourceMetadata/);
  assert.match(ingestion, /healSourceMetadataFromPosts/);
  assert.match(ingestion, /sourceMetadata/);
  assert.match(radar, /withHealedSourceMetadata/);
});

test('all PostgreSQL clients share the centralized TLS policy', () => {
  const database = read('server/db/database.ts');
  const auth = read('server/auth/appAuth.ts');
  const release = read('server/releases/releaseStore.ts');
  assert.match(database, /ssl: postgresSsl\(dbUrl\)/);
  assert.match(auth, /ssl: postgresSsl\(dbUrl\)/);
  assert.match(release, /ssl: postgresSsl\(databaseUrl\)/);
});

test('inactive Web Push placeholder is removed until end-to-end delivery exists', () => {
  const worker = read('public/sw.js');
  assert.doesNotMatch(worker, /addEventListener\('push'/);
  assert.doesNotMatch(worker, /showNotification/);
});

test('UI copy does not promise instant or fabricated demo activity', () => {
  const i18n = read('src/lib/i18n.ts');
  assert.doesNotMatch(i18n, /Instant Push Alert|إشعار فوري لحظي|رادارك في 30 ثانية|realistic social feeds/);
  assert.match(i18n, /device check detects a match/);
  assert.match(i18n, /يكتشف فحص الجهاز تطابقًا/);
});
