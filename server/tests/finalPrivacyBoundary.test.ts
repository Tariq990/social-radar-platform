import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeTransportMetadata } from '../../src/lib/privacy';
import { SourceConnectorManager } from '../connectors/sourceConnector';

test('transport metadata drops secret-shaped and nested values before network use', () => {
  const safe = sanitizeTransportMetadata({
    feedIndex: 3,
    pinned: false,
    collector: 'dom',
    c_user: 'must-not-leave-device',
    xs: 'must-not-leave-device',
    CookieHeader: 'must-not-leave-device',
    access_token: 'must-not-leave-device',
    nested: { token: 'must-not-leave-device' }
  });
  assert.deepEqual(safe, { feedIndex: 3, pinned: false, collector: 'dom' });
});

test('transport metadata enforces entry and string bounds', () => {
  const input: Record<string, unknown> = { longText: 'x'.repeat(5000) };
  for (let index = 0; index < 100; index++) input[`field${index}`] = index;
  const safe = sanitizeTransportMetadata(input);
  assert.equal(Object.keys(safe).length, 64);
  assert.equal(String(safe.longText).length, 2000);
});

test('device ingestion sanitizes metadata before serializing the request', () => {
  const api = fs.readFileSync('src/services/api.ts', 'utf8');
  const connector = fs.readFileSync('src/connectors/deviceSessionConnector.ts', 'utf8');
  assert.match(api, /metadata: sanitizeTransportMetadata\(post\.metadata\)/);
  assert.match(connector, /sanitizeTransportMetadata\(post\.metadata\)/);
  assert.doesNotMatch(connector, /detailError: String\(error\?\.message/);
  assert.match(connector, /detailError: detailCollectionErrorCode\(error\)/);
});

test('worker errors are structural and do not persist raw exception messages', () => {
  const ingest = fs.readFileSync('server/worker/deviceIngestion.ts', 'utf8');
  const monitor = fs.readFileSync('server/worker/monitoringWorker.ts', 'utf8');
  assert.match(ingest, /error: 'EVALUATION_FAILED'/);
  assert.doesNotMatch(ingest, /String\(error\?\.message \|\| 'AI evaluation failed'/);
  assert.match(monitor, /SOURCE_FETCH_FAILED/);
  assert.match(monitor, /EVALUATION_FAILED/);
  assert.doesNotMatch(monitor, /sourceError\?\.message|evalError\?\.message/);
});

test('source connector classifies by URL hostname, not query/path substrings', async () => {
  const manager = new SourceConnectorManager();
  const result = await manager.resolve({ url: 'https://evil.example/?next=facebook.com' }, false);
  assert.equal(result.valid, false);
  assert.equal(result.platform, 'other');
});

test('database diagnostics do not print database URL fragments, local paths, or raw exceptions', () => {
  const database = fs.readFileSync('server/db/database.ts', 'utf8');
  assert.doesNotMatch(database, /dbUrl\.split\('@'\)/);
  assert.doesNotMatch(database, /Local persistent store loaded from/);
  assert.doesNotMatch(database, /starting fresh', e|persist data to disk', e/);
});

test('frontend runtime diagnostics do not expose raw exception objects or native error text', () => {
  const radar = fs.readFileSync('src/context/RadarContext.tsx', 'utf8');
  const settings = fs.readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.doesNotMatch(radar, /console\.warn\([^\n]*,\s*error\)/);
  assert.doesNotMatch(radar, /Authenticated scan failed for \$\{source\.id\}/);
  assert.doesNotMatch(settings, /setError\(err\?\.message/);
  assert.match(settings, /if \(!connected\) \{\s*setError\(/s);
});
