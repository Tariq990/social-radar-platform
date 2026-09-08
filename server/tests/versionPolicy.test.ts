import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAndroidUpdateDecision } from '../releases/versionPolicy';

const release = {
  channel: 'android-alpha' as const,
  versionCode: 50,
  versionName: '0.1.50',
  minSupportedVersionCode: 50,
  mandatory: true,
  sha256: 'a'.repeat(64),
  sizeBytes: 6_000_000,
  publishedAt: '2026-09-08T00:00:00.000Z'
};

test('mandatory Android release blocks every older build', () => {
  const decision = buildAndroidUpdateDecision(49, release);
  assert.equal(decision.updateAvailable, true);
  assert.equal(decision.updateRequired, true);
});

test('current Android build is not asked to update itself', () => {
  const decision = buildAndroidUpdateDecision(50, release);
  assert.equal(decision.updateAvailable, false);
  assert.equal(decision.updateRequired, false);
});

test('newer local build is not downgraded', () => {
  const decision = buildAndroidUpdateDecision(51, release);
  assert.equal(decision.updateAvailable, false);
  assert.equal(decision.updateRequired, false);
});
