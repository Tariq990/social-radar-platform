import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('silent rules persist matches without dispatching notifications and round-trip through the frontend', () => {
  const types = read('src/types/index.ts');
  const api = read('src/services/api.ts');
  const device = read('server/worker/deviceIngestion.ts');
  const server = read('server/worker/monitoringWorker.ts');

  assert.match(types, /alertMode: 'instant' \| 'digest' \| 'silent'/);
  assert.match(api, /r\.alert_mode === 'silent' \? 'silent'/);
  assert.match(device, /if \(rule\.alert_mode !== 'silent'\) \{[\s\S]*dispatchMatchNotification/s);
  assert.match(server, /if \(rule\.alert_mode !== 'silent'\) \{[\s\S]*dispatchMatchNotification/s);
});

test('Android updater and FileProvider are pinned to the update endpoint only', () => {
  const updater = read('android/app/src/main/java/com/mrscrap/socialradar/AppUpdatePlugin.java');
  const paths = read('android/app/src/main/res/xml/file_paths.xml');

  assert.match(updater, /UPDATE_APK_PATH = "\/api\/app\/update\/apk"/);
  assert.match(updater, /new URL\(BuildConfig\.MR_SCRAP_BACKEND_ORIGIN\)/);
  assert.match(updater, /sameHttpsOrigin\(trustedOrigin, requested\)/);
  assert.match(updater, /UPDATE_APK_PATH\.equals\(requested\.getPath\(\)\)/);
  assert.match(updater, /safeInstallFailureMessage\(error\)/);
  assert.doesNotMatch(updater, /call\.reject\(error\.getMessage\(\)\)/);

  assert.match(paths, /<cache-path name="updates" path="updates\/" \/>/);
  assert.doesNotMatch(paths, /<files-path/);
  assert.doesNotMatch(paths, /path="\."/);
});

test('Android match notifications keep content private on the lockscreen', () => {
  const notifications = read('android/app/src/main/java/com/mrscrap/socialradar/RadarNotificationHelper.java');
  assert.match(notifications, /channel\.setLockscreenVisibility\(Notification\.VISIBILITY_PRIVATE\)/);
  assert.match(notifications, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
});

test('source resolution contracts do not accept device session credentials', () => {
  const connectorTypes = read('src/connectors/types.ts');
  assert.doesNotMatch(connectorTypes, /deviceSessionToken/);
});

test('production startup refuses local persistence', () => {
  const server = read('server.ts');
  assert.match(server, /APP_MODE === 'production' && !db\.isUsingPostgres\(\)/);
  assert.match(server, /Production startup aborted: DATABASE_URL is missing\/unreachable/);
});

test('main UI script CSP rejects inline script execution and uses packaged boot code', () => {
  const index = read('index.html');
  const boot = read('public/boot.js');
  const scriptPolicy = index.match(/script-src\s+([^;]+);/)?.[1] || '';

  assert.equal(scriptPolicy.trim(), "'self'");
  assert.doesNotMatch(scriptPolicy, /unsafe-inline/);
  assert.match(index, /<script src="\/boot\.js"><\/script>/);
  assert.doesNotMatch(index, /\sonload=/i);
  assert.match(boot, /mrscrap_theme_v2/);
  assert.match(boot, /mrscrap_locale_v2/);
});

test('malformed Smart Grab records never dump raw exceptions in production', () => {
  const explore = read('src/services/explore.ts');
  assert.match(explore, /catch \{\s*if \(import\.meta\.env\.DEV\) console\.warn\('\[apiExploreDevicePosts\] Ignoring malformed item'\);\s*\}/s);
  assert.doesNotMatch(explore, /Ignoring malformed item',\s*error/);
});
