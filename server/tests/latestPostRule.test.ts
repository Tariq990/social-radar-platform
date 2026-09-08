import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePostAgainstRule } from '../ai/ruleEvaluator';

function post(feedIndex: number, pinned = false): any {
  return {
    id: `post-${feedIndex}`,
    source_id: 'source-1',
    platform: 'facebook',
    canonical_url: `https://www.facebook.com/example/posts/${feedIndex + 1}`,
    author_name: 'Example Page',
    text: 'A real newly collected Facebook post.',
    media: [],
    fingerprint: `fp-${feedIndex}`,
    metadata: { feedIndex, pinned }
  };
}

function rule(text: string): any {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    name: 'Latest post',
    natural_language: text,
    include_terms: [],
    exclude_terms: [],
    min_confidence: 0.82,
    alert_mode: 'instant',
    enabled: true,
    source_ids: ['source-1']
  };
}

test('Arabic latest-post rule matches the top real feed post without an AI round trip', async () => {
  const result = await evaluatePostAgainstRule(post(0), rule('نبهني آخر بوست نزل'), 'ar');
  assert.equal(result.matched, true);
  assert.equal(result.confidence, 1);
  assert.equal(result.category, 'New Post');
});

test('latest-post rule ignores older visible feed items', async () => {
  const result = await evaluatePostAgainstRule(post(1), rule('Notify me about the latest post'), 'en');
  assert.equal(result.matched, false);
});

test('latest-post rule ignores a pinned item even when it is visually first', async () => {
  const result = await evaluatePostAgainstRule(post(0, true), rule('نبهني اخر منشور نزل'), 'ar');
  assert.equal(result.matched, false);
});
