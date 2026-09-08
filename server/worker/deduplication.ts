import crypto from 'crypto';

/**
 * Deterministic post deduplication fingerprint generator.
 * Priority:
 * 1. External platform post ID (e.g. Facebook post ID, Instagram shortcode)
 * 2. Normalized canonical post URL (query params and tracking tags stripped)
 * 3. Content hash fallback (normalized text content)
 * 
 * Never uses Date.now() or random numbers.
 */
export function computePostFingerprint(
  platform: 'facebook' | 'instagram' | string,
  externalId?: string,
  canonicalUrl?: string,
  text?: string
): string {
  // 1. External Platform Post ID
  if (externalId && typeof externalId === 'string' && externalId.trim().length > 0) {
    const cleanId = externalId.trim();
    // Guard against generic or placeholder strings
    if (!cleanId.startsWith('post_') && cleanId !== 'unknown') {
      return `${platform}:id:${cleanId}`;
    }
  }

  // 2. Normalized Canonical URL
  if (canonicalUrl && typeof canonicalUrl === 'string' && canonicalUrl.trim().length > 0) {
    try {
      const parsed = new URL(canonicalUrl.startsWith('http') ? canonicalUrl : `https://${canonicalUrl}`);
      // Strip dynamic tracking parameters that change per session
      const trackingParams = [
        'fbclid', 'igshid', 'ref', 'source', 'utm_source', 'utm_medium',
        'utm_campaign', 'utm_term', 'utm_content', 'notif_id', 'notif_t',
        '__cft__', '__tn__'
      ];
      trackingParams.forEach(p => parsed.searchParams.delete(p));
      const cleanPathAndSearch = `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
      const hash = crypto.createHash('sha256').update(cleanPathAndSearch).digest('hex').substring(0, 20);
      return `${platform}:url:${hash}`;
    } catch {
      // Fall through to content hash
    }
  }

  // 3. Deterministic Content Hash Fallback
  const normalizedText = (text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ''); // Keep alphanumeric and unicode letters

  const contentHash = crypto
    .createHash('sha256')
    .update(`${platform}:${normalizedText}`)
    .digest('hex')
    .substring(0, 24);

  return `${platform}:content:${contentHash}`;
}

/**
 * Cleans and normalizes a social media URL to a canonical format.
 */
export function canonicalizeSocialUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    // Standardize mobile subdomains
    if (parsed.hostname === 'm.facebook.com' || parsed.hostname === 'mobile.facebook.com' || parsed.hostname === 'web.facebook.com') {
      parsed.hostname = 'www.facebook.com';
    }
    // Remove query parameters
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim();
  }
}
