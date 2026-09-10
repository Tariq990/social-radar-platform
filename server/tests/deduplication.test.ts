import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeSocialUrl, computePostFingerprint } from '../worker/deduplication';

test('canonicalization removes tracking but preserves Facebook story identity', () => {
  const input = 'https://m.facebook.com/story.php?story_fbid=111&id=222&fbclid=tracking&utm_source=x#fragment';
  const canonical = canonicalizeSocialUrl(input);

  assert.match(canonical, /^https:\/\/www\.facebook\.com\/story\.php\?/);
  assert.match(canonical, /story_fbid=111/);
  assert.match(canonical, /id=222/);
  assert.doesNotMatch(canonical, /fbclid=/);
  assert.doesNotMatch(canonical, /utm_source=/);
  assert.doesNotMatch(canonical, /#fragment/);
});

test('URL fingerprints are stable across tracking noise', () => {
  const a = canonicalizeSocialUrl('https://www.facebook.com/example/posts/123?fbclid=a&utm_campaign=x');
  const b = canonicalizeSocialUrl('https://facebook.com/example/posts/123?fbclid=b');

  assert.equal(
    computePostFingerprint('facebook', undefined, a, 'same'),
    computePostFingerprint('facebook', undefined, b, 'same')
  );
});

test('Facebook story query identifiers produce distinct URL fingerprints', () => {
  const a = canonicalizeSocialUrl('https://www.facebook.com/story.php?story_fbid=111&id=222');
  const b = canonicalizeSocialUrl('https://www.facebook.com/story.php?story_fbid=112&id=222');

  assert.notEqual(
    computePostFingerprint('facebook', undefined, a, 'same text'),
    computePostFingerprint('facebook', undefined, b, 'same text')
  );
});

test('external post ID takes precedence over URL/text', () => {
  assert.equal(
    computePostFingerprint('instagram', 'ABC123', 'https://instagram.com/p/anything', 'hello'),
    'instagram:id:ABC123'
  );
});

test('canonicalization fails closed for malformed or unsupported URL input', () => {
  assert.equal(canonicalizeSocialUrl('http://[invalid'), '');
  assert.equal(canonicalizeSocialUrl('javascript:alert(1)'), '');
});
