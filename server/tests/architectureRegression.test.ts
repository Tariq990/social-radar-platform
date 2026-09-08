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
