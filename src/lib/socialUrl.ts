const FACEBOOK_HOSTS = new Set(['facebook.com', 'fb.com', 'fb.watch']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'instagr.am']);
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SOCIAL_HOST_FRAGMENT = /(?:(?:www|m|mobile|web)\.)?(?:facebook\.com|fb\.com|fb\.watch|instagram\.com|instagr\.am)(?:\/[^\s<>"']*)?/i;

function matchesHost(hostname: string, roots: Set<string>): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const root of roots) {
    if (host === root || host.endsWith(`.${root}`)) return true;
  }
  return false;
}

function isSupportedSocialHost(hostname: string): boolean {
  return matchesHost(hostname, FACEBOOK_HOSTS) || matchesHost(hostname, INSTAGRAM_HOSTS);
}

function cleanCandidate(value: string): string {
  return value
    .replace(BIDI_MARKS, '')
    .replace(/^[([{<]+/, '')
    .replace(/[)\]}>.,;،؛!?]+$/, '')
    .trim();
}

function normalizeToHttps(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (!isSupportedSocialHost(parsed.hostname)) return value.trim();
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.trim();
  }
}

export function isSupportedSocialUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return false;
    return isSupportedSocialHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function extractSupportedSocialUrl(value: string): string | null {
  if (!value || typeof value !== 'string') return null;
  const text = value.replace(BIDI_MARKS, ' ').trim();
  if (!text) return null;

  const candidates: string[] = [...(text.match(/https?:\/\/[^\s<>"']+/gi) || [])];
  const hostOnly = text.match(SOCIAL_HOST_FRAGMENT)?.[0];
  if (hostOnly) candidates.push(/^https?:\/\//i.test(hostOnly) ? hostOnly : `https://${hostOnly}`);
  if (candidates.length === 0) candidates.push(text);

  for (const raw of candidates) {
    let cleaned = cleanCandidate(raw);
    if (!/^https?:\/\//i.test(cleaned) && SOCIAL_HOST_FRAGMENT.test(cleaned)) cleaned = `https://${cleaned}`;
    cleaned = normalizeToHttps(cleaned);
    if (!isSupportedSocialUrl(cleaned)) continue;
    return cleaned;
  }
  return null;
}
