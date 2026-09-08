import { SourceInput, ResolvedSourceResult, SourcePlatform } from './types';
import { canonicalizeSocialUrl } from '../worker/deduplication';

/**
 * Direct OpenGraph and Meta Tag Resolver.
 * Connects directly to Facebook and Instagram public URLs using standard web clients
 * to extract the 100% REAL page title, REAL profile image, and description directly from Meta's CDN.
 */
export class PublicMetaResolver {
  async resolve(input: SourceInput): Promise<ResolvedSourceResult | null> {
    const raw = (input.url || '').trim();
    if (!raw) return null;

    const isFb = raw.includes('facebook.com') || raw.includes('fb.com') || raw.includes('fb.watch');
    const isIg = raw.includes('instagram.com') || raw.includes('instagr.am');

    if (!isFb && !isIg) return null;

    const platform: SourcePlatform = isFb ? 'facebook' : 'instagram';
    const canonicalUrl = canonicalizeSocialUrl(raw);

    // Extract handle / slug
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

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Standard user-agent that receives public social preview meta tags
      const response = await fetch(canonicalUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Chrome/120.0.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
        },
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 999) {
        // Status 404 means the page truly doesn't exist
        if (response.status === 404) {
          return {
            valid: false,
            platform,
            externalId: handle,
            name: '',
            handle: `@${handle}`,
            url: canonicalUrl,
            visibilityType: 'public',
            connectorType: 'public_cloud',
            connectorStatus: 'error',
            requiresAuthentication: false,
            error: `Page not found on ${platform === 'facebook' ? 'Facebook' : 'Instagram'}. Please verify the URL.`
          };
        }
      }

      const html = await response.text();

      // Extract OpenGraph meta properties
      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<meta\s+name=["']title["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<title>(.*?)<\/title>/i);

      const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i) ||
                           html.match(/<meta\s+name=["']twitter:image["']\s+content=["'](.*?)["']/i);

      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i) ||
                          html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);

      let extractedTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';
      // Clean Facebook page title suffix (e.g. "Coca-Cola | Facebook" -> "Coca-Cola")
      extractedTitle = extractedTitle.replace(/\s*\|\s*Facebook$/i, '').replace(/\s*•\s*Instagram photos and videos$/i, '');

      // Decode common HTML entities (&amp;, &#039;, etc.)
      extractedTitle = extractedTitle
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      let extractedImage = ogImageMatch ? ogImageMatch[1].trim().replace(/&amp;/g, '&') : '';
      let extractedDesc = ogDescMatch ? ogDescMatch[1].trim().replace(/&amp;/g, '&') : '';

      // If we got genuine page information from the live page
      if (extractedTitle && extractedTitle.length > 1 && !extractedTitle.toLowerCase().includes('log in') && !extractedTitle.toLowerCase().includes('welcome to facebook')) {
        return {
          valid: true,
          platform,
          externalId: handle,
          name: extractedTitle,
          handle: `@${handle}`,
          avatarUrl: extractedImage || undefined,
          url: canonicalUrl,
          bio: extractedDesc || undefined,
          visibilityType: 'public',
          connectorType: 'public_cloud',
          connectorStatus: 'connected',
          requiresAuthentication: false
        };
      }
    } catch (err: any) {
      console.warn('[PublicMetaResolver] Direct fetch attempt timed out or failed:', err?.message);
    }

    return null;
  }
}
