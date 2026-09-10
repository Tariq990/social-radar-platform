import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('authentication middleware never returns infrastructure exception messages to clients', () => {
  const appAuth = read('server/auth/appAuth.ts');
  const deviceAuth = read('server/auth/deviceAuth.ts');

  assert.match(appAuth, /catch \{\s*return res\.status\(503\)\.json\(\{ error: 'Authentication unavailable' \}\);\s*\}/s);
  assert.doesNotMatch(appAuth, /res\.status\(503\)[^\n]*error\?\.message/);

  assert.match(deviceAuth, /catch \{\s*return res\.status\(503\)\.json\(\{ error: 'Device authorization unavailable' \}\);\s*\}/s);
  assert.doesNotMatch(deviceAuth, /res\.status\(503\)[^\n]*error\?\.message/);
});
