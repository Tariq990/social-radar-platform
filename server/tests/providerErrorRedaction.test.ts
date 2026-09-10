import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('public provider failures never expose raw response bodies or network exception messages', () => {
  const apify = read('server/connectors/apifyConnector.ts');
  assert.doesNotMatch(apify, /const errorText = \(await res\.text\(\)\)/);
  assert.doesNotMatch(apify, /const errText = \(await res\.text\(\)\)/);
  assert.doesNotMatch(apify, /err\?\.message \|\| 'Network error connecting to Apify'/);
  assert.doesNotMatch(apify, /Apify execution failed:.*err\?\.message/s);
  assert.match(apify, /Public provider could not resolve this source \(HTTP \$\{res\.status\}\)\./);
  assert.match(apify, /throw new Error\(`Public provider rejected collection with HTTP \$\{res\.status\}`\)/);
});

test('public metadata resolver logs only structural failure codes', () => {
  const resolver = read('server/connectors/metaResolver.ts');
  assert.doesNotMatch(resolver, /console\.warn\([^\n]*err\?\.message/);
  assert.match(resolver, /err\?\.name === 'AbortError' \? 'timeout' : 'request_failed'/);
});
