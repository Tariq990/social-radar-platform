import crypto from 'crypto';

const TRACKING_PARAMS = new Set([
  'fbclid', 'igshid', 'ref', 'source', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_term', 'utm_content', 'notif_id', 'notif_t',
  '__cft__', '__tn__', 'mibextid'
]);

function normalizeUrlForIdentity(rawUrl: string): string {
  const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);

  if (
    parsed.hostname === 'm.facebook.com' ||
    parsed.hostname === 'mobile.facebook.com' ||
    parsed.hostname === 'web.facebook.com'
  ) {
    parsed.hostname = 'www.facebook.com';
  }

  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();

  const pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const search = parsed.searchParams.toString();
  return `${parsed.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ''}`;
}

/**
 * Deterministic post deduplication fingerprint generator.
 * Priority:
 * 1. External platform post ID (e.g. Facebook post ID, Instagram shortcode)
 * 2. Canonical post URL with tracking removed but identity-bearing query params preserved
 * 3. Content hash fallback
 *
 * Never uses Date.now() or random values.
 */
export function computePostFingerprint(
  platform: 'facebook' | 'instagram' | string,
  externalId?: string,
  canonicalUrl?: string,
  text?: string
): string {
  if (externalId && typeof externalId === 'string' && externalId.trim().length > 0) {
    const cleanId = externalId.trim();
    if (!cleanId.startsWith('post_') && cleanId !== 'unknown') {
      return `${platform}:id:${cleanId}`;
    }
  }

  if (canonicalUrl && typeof canonicalUrl === 'string' && canonicalUrl.trim().length > 0) {
    try {
      const identityUrl = normalizeUrlForIdentity(canonicalUrl);
      const hash = crypto.createHash('sha256').update(identityUrl).digest('hex').substring(0, 20);
      return `${platform}:url:${hash}`;
    } catch {
      // Fall through to content hash.
    }
  }

  const normalizedText = (text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '');

  const contentHash = crypto
    .createHash('sha256')
    .update(`${platform}:${normalizedText}`)
    .digest('hex')
    .substring(0, 24);

  return `${platform}:content:${contentHash}`;
}

/**
 * Normalizes a social URL without deleting query parameters that identify the actual post
 * (for example Facebook story_fbid/id). Only known tracking/noise parameters are removed.
 */
export function canonicalizeSocialUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);

    if (
      parsed.hostname === 'm.facebook.com' ||
      parsed.hostname === 'mobile.facebook.com' ||
      parsed.hostname === 'web.facebook.com'
    ) {
      parsed.hostname = 'www.facebook.com';
    }

    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return rawUrl.trim();
  }
}
