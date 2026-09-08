import { SourceInput, ResolvedSourceResult, SourcePlatform } from './types';
import { canonicalizeSocialUrl } from '../worker/deduplication';

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const RESOLVE_TIMEOUT_MS = 3500;

function platformForUrl(raw: string): SourcePlatform | 'other' {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'other';
    const host = parsed.hostname.toLowerCase();
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') return 'facebook';
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) return 'instagram';
    return 'other';
  } catch { return 'other'; }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, code) => Number.isFinite(Number(code)) ? String.fromCodePoint(Number(code)) : '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => Number.isFinite(Number.parseInt(code, 16)) ? String.fromCodePoint(Number.parseInt(code, 16)) : '')
    .trim();
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(["'])(.*?)\2/gs;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) attrs[match[1].toLowerCase()] = decodeHtml(match[3]);
  return attrs;
}

function metaContent(html: string, keys: string[]): string {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseAttributes(tag);
    const identity = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (wanted.has(identity) && attrs.content) return attrs.content.trim();
  }
  return '';
}

function linkHref(html: string, relName: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseAttributes(tag);
    if ((attrs.rel || '').toLowerCase().split(/\s+/).includes(relName.toLowerCase()) && attrs.href) return decodeHtml(attrs.href);
  }
  return '';
}

function titleContent(html: string): string {
  return decodeHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' '));
}

function deriveHandleOrId(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
    const first = (parts[0] || '').trim();
    const lower = first.toLowerCase();
    if (lower === 'profile.php') return (parsed.searchParams.get('id') || '').trim();
    if (lower === 'groups' && parts[1]) return parts[1].replace(/^@/, '').trim();
    if (first && !['p', 'reel', 'reels', 'posts', 'permalink', 'permalink.php', 'story.php', 'photo', 'photo.php', 'watch', 'share', 'videos', 'accounts'].includes(lower)) return first.replace(/^@/, '').trim();
    return (parsed.searchParams.get('id') || parsed.searchParams.get('user') || '').trim();
  } catch { return ''; }
}

function embeddedProfileImage(html: string): string {
  const patterns = [
    /["']profile_pic_url_hd["']\s*:\s*["']([^"']+)/i,
    /["']profile_pic_url["']\s*:\s*["']([^"']+)/i,
    /["']profilePicture["']\s*:\s*\{[^{}]*?["']uri["']\s*:\s*["']([^"']+)/i
  ];
  for (const pattern of patterns) {
    const raw = html.match(pattern)?.[1];
    if (!raw) continue;
    const value = raw.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/\\u0025/gi, '%');
    if (/^https?:\/\//i.test(value)) return value;
  }
  return '';
}

async function readBoundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_HTML_BYTES) throw new Error('Public metadata response is too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0, html = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) { await reader.cancel(); throw new Error('Public metadata response exceeded size limit'); }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally { reader.releaseLock(); }
}

async function fetchMetaHtml(initialUrl: string, signal: AbortSignal): Promise<{ response: Response; finalUrl: string; html: string }> {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (platformForUrl(current) === 'other') throw new Error('Meta resolver refused a non-Facebook/Instagram URL');
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
      if (platformForUrl(nextUrl) === 'other') throw new Error('Meta resolver refused redirect outside Facebook/Instagram');
      current = nextUrl;
      continue;
    }
    return { response, finalUrl: current, html: await readBoundedText(response) };
  }
  throw new Error('Public metadata resolution failed');
}

export class PublicMetaResolver {
  async resolve(input: SourceInput): Promise<ResolvedSourceResult | null> {
    const raw = (input.url || '').trim();
    if (!raw) return null;
    const platform = platformForUrl(raw);
    if (platform === 'other') return null;
    const canonicalUrl = canonicalizeSocialUrl(raw);
    const handle = deriveHandleOrId(canonicalUrl) || deriveHandleOrId(raw) || 'page';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

    try {
      const { response, finalUrl, html } = await fetchMetaHtml(canonicalUrl, controller.signal);
      if (response.status === 404) {
        return { valid: false, platform, externalId: handle, name: '', handle: `@${handle}`, url: finalUrl, visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error', requiresAuthentication: false, error: `Page not found on ${platform === 'facebook' ? 'Facebook' : 'Instagram'}. Please verify the URL.` };
      }
      let title = metaContent(html, ['og:title', 'twitter:title', 'title']) || titleContent(html);
      title = decodeHtml(title).replace(/\s*[|·-]\s*Facebook\s*$/i, '').replace(/\s*[|·-]\s*Instagram\s*$/i, '').replace(/\s*•\s*Instagram photos and videos\s*$/i, '').trim();
      const image = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) || linkHref(html, 'image_src') || embeddedProfileImage(html);
      const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
      const badTitle = /^(facebook|instagram|log in|log into facebook|welcome to facebook|error facebook)$/i.test(title) || /log in to facebook/i.test(title);
      if (title && title.length > 1 && !badTitle) {
        return {
          valid: true,
          platform,
          externalId: handle,
          name: title.slice(0, 255),
          handle: `@${handle}`,
          avatarUrl: image || undefined,
          url: finalUrl,
          bio: description ? decodeHtml(description).slice(0, 5000) : undefined,
          visibilityType: 'public',
          connectorType: 'public_cloud',
          connectorStatus: 'connected',
          requiresAuthentication: false
        };
      }
    } catch (err: any) {
      console.warn('[PublicMetaResolver] Direct metadata fetch unavailable:', err?.name === 'AbortError' ? 'timeout' : err?.message);
    } finally { clearTimeout(timeoutId); }
    return null;
  }
}
