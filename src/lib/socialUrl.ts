const FACEBOOK_HOSTS = new Set(['facebook.com', 'fb.com', 'fb.watch']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'instagr.am']);

function matchesHost(hostname: string, roots: Set<string>): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const root of roots) {
    if (host === root || host.endsWith(`.${root}`)) return true;
  }
  return false;
}

export function isSupportedSocialUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return matchesHost(parsed.hostname, FACEBOOK_HOSTS) || matchesHost(parsed.hostname, INSTAGRAM_HOSTS);
  } catch {
    return false;
  }
}

export function extractSupportedSocialUrl(value: string): string | null {
  if (!value || typeof value !== 'string') return null;
  const candidates = value.match(/https?:\/\/[^\s<>"']+/gi) || [value.trim()];
  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/[),.;!?\]}]+$/, '');
    if (!isSupportedSocialUrl(cleaned)) continue;
    try {
      const parsed = new URL(cleaned);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      // Keep scanning if the candidate changed unexpectedly after validation.
    }
  }
  return null;
}
