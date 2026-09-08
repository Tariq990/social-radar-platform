import { 
  ISourceConnector, 
  SourceInput, 
  ResolvedSourceResult, 
  RawProviderPost, 
  SourcePlatform,
  ConnectorError
} from './types';
import { canonicalizeSocialUrl } from '../worker/deduplication';

/**
 * Real Apify Cloud Connector for Public Facebook and Instagram monitoring.
 * Uses Apify REST API to execute certified actors and retrieve real live post datasets.
 */
export class ApifyConnector implements ISourceConnector {
  readonly providerName = 'Apify Cloud';
  private apiToken: string | null = null;
  private baseUrl = 'https://api.apify.com/v2';

  constructor() {
    this.apiToken = process.env.APIFY_API_TOKEN || null;
  }

  private getToken(): string | null {
    return this.apiToken || process.env.APIFY_API_TOKEN || null;
  }

  isConfigured(): boolean {
    return Boolean(this.getToken());
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const token = this.getToken();
    if (!token) {
      return { ok: false, latencyMs: 0, message: 'APIFY_API_TOKEN is not configured.' };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/users/me?token=${token}`);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        return {
          ok: true,
          latencyMs,
          message: `Connected as ${data.data?.username || 'Apify User'}`
        };
      }
      return {
        ok: false,
        latencyMs,
        message: `Apify API rejected token: HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err?.message || 'Network error connecting to Apify'
      };
    }
  }

  async resolveSource(input: SourceInput): Promise<ResolvedSourceResult> {
    const rawUrl = (input.url || '').trim();
    if (!rawUrl) {
      return {
        valid: false,
        platform: 'other',
        externalId: '',
        name: '',
        handle: '',
        url: '',
        visibilityType: 'public',
        connectorType: 'public_cloud',
        connectorStatus: 'error',
        requiresAuthentication: false,
        error: 'URL is required'
      };
    }

    const isFb = rawUrl.includes('facebook.com') || rawUrl.includes('fb.com');
    const isIg = rawUrl.includes('instagram.com') || rawUrl.includes('instagr.am');

    if (!isFb && !isIg) {
      return {
        valid: false,
        platform: 'other',
        externalId: '',
        name: '',
        handle: '',
        url: rawUrl,
        visibilityType: 'public',
        connectorType: 'public_cloud',
        connectorStatus: 'error',
        requiresAuthentication: false,
        error: 'Only Facebook and Instagram public URLs are supported'
      };
    }

    const platform: SourcePlatform = isFb ? 'facebook' : 'instagram';
    const canonicalUrl = canonicalizeSocialUrl(rawUrl);

    // Extract handle / username
    let handle = 'page';
    try {
      const parsed = new URL(canonicalUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      handle = parts[0] || 'page';
      if (['p', 'reel', 'stories', 'posts', 'groups'].includes(handle) && parts[1]) {
        handle = parts[1];
      }
    } catch {
      handle = rawUrl.split('/').filter(Boolean).pop() || 'page';
    }

    const token = this.getToken();
    if (!token) {
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
        error: 'APIFY_API_TOKEN is not configured. Add your Apify token in environment variables to fetch real posts.'
      };
    }

    // Call Apify actor to inspect the source
    try {
      const actorId = platform === 'facebook' 
        ? (process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper')
        : (process.env.APIFY_IG_ACTOR || 'apify~instagram-scraper');

      const actorInput = platform === 'facebook' 
        ? { startUrls: [{ url: canonicalUrl }], resultsLimit: 1 }
        : { directUrls: [canonicalUrl], resultsLimit: 1 };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000); // 45s max run

      const res = await fetch(
        `${this.baseUrl}/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=40`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(actorInput),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
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
          error: `Apify Actor error (${res.status}): ${errorText.substring(0, 150)}`
        };
      }

      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) {
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
          error: `No public data returned by Apify for this ${platform} URL. The page might be private or geo-restricted.`
        };
      }

      const first = items[0];
      const realName = first.pageName || first.ownerFullName || first.authorName || handle;
      const realAvatar = first.profilePicUrl || first.profilePicture || first.pageImage || first.ownerProfilePicUrl;
      const realBio = first.biography || first.pageBio || first.bio || '';

      return {
        valid: true,
        platform,
        externalId: first.pageId || first.ownerId || handle,
        name: realName,
        handle: `@${first.ownerUsername || handle}`,
        avatarUrl: realAvatar,
        url: canonicalUrl,
        bio: realBio,
        visibilityType: 'public',
        connectorType: 'public_cloud',
        connectorStatus: 'connected',
        requiresAuthentication: false
      };
    } catch (err: any) {
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
        error: `Apify execution failed: ${err?.name === 'AbortError' ? 'Request timed out' : err?.message}`
      };
    }
  }

  async fetchLatestPosts(source: { 
    id: string; 
    url: string; 
    platform: SourcePlatform; 
    externalId: string 
  }): Promise<RawProviderPost[]> {
    const token = this.getToken();
    if (!token) {
      throw new Error('APIFY_API_TOKEN is not configured on the server.');
    }

    const platform = source.platform;
    const actorId = platform === 'facebook'
      ? (process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper')
      : (process.env.APIFY_IG_ACTOR || 'apify~instagram-scraper');

    const actorInput = platform === 'facebook'
      ? { startUrls: [{ url: source.url }], resultsLimit: 5 }
      : { directUrls: [source.url], resultsLimit: 5 };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const res = await fetch(
      `${this.baseUrl}/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=55`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorInput),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Apify scraping error (HTTP ${res.status}): ${errText.substring(0, 150)}`);
    }

    const items = await res.json();
    if (!Array.isArray(items)) {
      return [];
    }

    // Normalize raw provider posts
    const normalized: RawProviderPost[] = [];

    for (const item of items) {
      // Facebook actor format
      if (platform === 'facebook') {
        const text = item.text || item.postText || item.message || '';
        const postUrl = item.url || item.postUrl || source.url;
        const externalId = item.postId || item.id || (postUrl !== source.url ? postUrl : undefined);
        const publishedAt = item.time || item.publishedAt || item.timestamp;
        const mediaUrls: { type: 'image' | 'video'; url: string }[] = [];

        if (Array.isArray(item.images)) {
          item.images.forEach((img: any) => {
            const u = typeof img === 'string' ? img : img?.url;
            if (u) mediaUrls.push({ type: 'image', url: u });
          });
        }
        if (item.mediaUrl) {
          mediaUrls.push({ type: item.isVideo ? 'video' : 'image', url: item.mediaUrl });
        }

        if (text || mediaUrls.length > 0) {
          normalized.push({
            id: `post_fb_${externalId || Math.random().toString(36).substr(2, 8)}`,
            externalId: externalId ? String(externalId) : undefined,
            url: postUrl,
            authorName: item.pageName || undefined,
            authorAvatar: item.profilePicture || undefined,
            text: text.trim(),
            media: mediaUrls,
            publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
            metadata: { apifyActor: actorId }
          });
        }
      }

      // Instagram actor format
      if (platform === 'instagram') {
        const text = item.caption || item.text || '';
        const postUrl = item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : source.url);
        const externalId = item.id || item.shortCode;
        const publishedAt = item.timestamp ? new Date(item.timestamp).toISOString() : undefined;
        const mediaUrls: { type: 'image' | 'video'; url: string }[] = [];

        if (item.displayUrl) {
          mediaUrls.push({ type: item.isVideo ? 'video' : 'image', url: item.displayUrl });
        }
        if (Array.isArray(item.images)) {
          item.images.forEach((img: any) => {
            const u = typeof img === 'string' ? img : img?.url;
            if (u) mediaUrls.push({ type: 'image', url: u });
          });
        }

        if (text || mediaUrls.length > 0) {
          normalized.push({
            id: `post_ig_${externalId || Math.random().toString(36).substr(2, 8)}`,
            externalId: externalId ? String(externalId) : undefined,
            url: postUrl,
            authorName: item.ownerFullName || item.ownerUsername || undefined,
            authorAvatar: item.ownerProfilePicUrl || undefined,
            text: text.trim(),
            media: mediaUrls,
            publishedAt: publishedAt || new Date().toISOString(),
            metadata: { apifyActor: actorId }
          });
        }
      }
    }

    return normalized;
  }
}
