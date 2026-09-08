import { SourceInput, ResolvedSourceResult, SourcePlatform } from './types';
import { canonicalizeSocialUrl } from '../worker/deduplication';

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

function platformForUrl(raw: string): SourcePlatform | 'other' {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'other';
    const host = parsed.hostname.toLowerCase();
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') {
      return 'facebook';
    }
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) {
      return 'instagram';
    }
    return 'other';
  } catch {
    return 'other';
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_HTML_BYTES) {
    throw new Error('Public metadata response is too large');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new Error('Public metadata response exceeded size limit');
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    reader.releaseLock();
  }
}

async function fetchMetaHtml(initialUrl: string, signal: AbortSignal): Promise<{ response: Response; finalUrl: string; html: string }> {
  let current = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const platform = platformForUrl(current);
    if (platform === 'other') throw new Error('Meta resolver refused a non-Facebook/Instagram URL');

    const response = await fetch(current, {
      signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Chrome/120.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      },
      redirect: 'manual'
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many public metadata redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Meta resolver received redirect without Location');
      const nextUrl = new URL(location, current).toString();
      if (platformForUrl(nextUrl) === 'other') {
        throw new Error('Meta resolver refused redirect outside Facebook/Instagram');
      }
      current = nextUrl;
      continue;
    }

    return { response, finalUrl: current, html: await readBoundedText(response) };
  }

  throw new Error('Public metadata resolution failed');
}

/**
 * Best-effort direct OpenGraph/meta-tag resolver for public Facebook/Instagram URLs.
 * A successful metadata read does not imply that the server can continuously monitor the
 * source; authenticated monitoring remains device-owned unless an optional public provider
 * is explicitly enabled.
 */
export class PublicMetaResolver {
  async resolve(input: SourceInput): Promise<ResolvedSourceResult | null> {
    const raw = (input.url || '').trim();
    if (!raw) return null;

    const platform = platformForUrl(raw);
    if (platform === 'other') return null;

    const canonicalUrl = canonicalizeSocialUrl(raw);

    let handle = 'page';
    try {
      const parsed = new URL(canonicalUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      handle = segments[0] || 'page';
      if (['p', 'reel', 'stories', 'posts', 'groups'].includes(handle) && segments[1]) {
        handle = segments[1];
      }
    } catch {
      handle = raw.split('/').filter(Boolean).pop() || 'page';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const { response, finalUrl, html } = await fetchMetaHtml(canonicalUrl, controller.signal);

      if (response.status === 404) {
        return {
          valid: false,
          platform,
          externalId: handle,
          name: '',
          handle: `@${handle}`,
          url: finalUrl,
          visibilityType: 'public',
          connectorType: 'public_cloud',
          connectorStatus: 'error',
          requiresAuthentication: false,
          error: `Page not found on ${platform === 'facebook' ? 'Facebook' : 'Instagram'}. Please verify the URL.`
        };
      }

      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<meta\s+name=["']title["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<title>(.*?)<\/title>/i);

      const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<meta\s+name=["']twitter:image["']\s+content=["'](.*?)["']/i);

      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i) ||
                          html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);

      let extractedTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';
      extractedTitle = extractedTitle.replace(/\s*\|\s*Facebook$/i, '').replace(/\s*•\s*Instagram photos and videos$/i, '');
      extractedTitle = extractedTitle
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      const extractedImage = ogImageMatch ? ogImageMatch[1].trim().replace(/&amp;/g, '&') : '';
      const extractedDesc = ogDescMatch ? ogDescMatch[1].trim().replace(/&amp;/g, '&') : '';

      if (extractedTitle && extractedTitle.length > 1 && !extractedTitle.toLowerCase().includes('log in') && !extractedTitle.toLowerCase().includes('welcome to facebook')) {
        return {
          valid: true,
          platform,
          externalId: handle,
          name: extractedTitle.slice(0, 255),
          handle: `@${handle}`,
          avatarUrl: extractedImage || undefined,
          url: finalUrl,
          bio: extractedDesc ? extractedDesc.slice(0, 5000) : undefined,
          visibilityType: 'public',
          connectorType: 'public_cloud',
          connectorStatus: 'connected',
          requiresAuthentication: false
        };
      }
    } catch (err: any) {
      console.warn('[PublicMetaResolver] Direct metadata fetch unavailable:', err?.name === 'AbortError' ? 'timeout' : err?.message);
    } finally {
      clearTimeout(timeoutId);
    }

    return null;
  }
}
