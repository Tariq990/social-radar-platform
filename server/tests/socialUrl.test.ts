import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSupportedSocialUrl, isSupportedSocialUrl } from '../../src/lib/socialUrl';

test('social URL helper accepts Facebook and Instagram links only', () => {
  assert.equal(isSupportedSocialUrl('https://www.facebook.com/NASA/'), true);
  assert.equal(isSupportedSocialUrl('https://m.facebook.com/NASA/'), true);
  assert.equal(isSupportedSocialUrl('https://www.instagram.com/nasa/'), true);
  assert.equal(isSupportedSocialUrl('https://example.com/facebook.com/NASA'), false);
  assert.equal(isSupportedSocialUrl('javascript:alert(1)'), false);
});

test('shared-text extraction handles punctuation, bidi marks, and scheme-less social links', () => {
  assert.equal(
    extractSupportedSocialUrl('شوف الصفحة: https://www.facebook.com/NASA/).'),
    'https://www.facebook.com/NASA/'
  );
  assert.equal(
    extractSupportedSocialUrl('\u200Finstagram.com/nasa\u200E'),
    'https://instagram.com/nasa'
  );
});

test('shared-text extraction never returns a non-social origin', () => {
  assert.equal(extractSupportedSocialUrl('https://example.com/path'), null);
  assert.equal(extractSupportedSocialUrl('not a URL'), null);
});
