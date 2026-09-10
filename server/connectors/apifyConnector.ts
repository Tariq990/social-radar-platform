import {
  ISourceConnector,
  SourceInput,
  ResolvedSourceResult,
  RawProviderPost,
  SourcePlatform
} from './types';
import { canonicalizeSocialUrl } from '../worker/deduplication';

function platformForSocialUrl(rawUrl: string): 'facebook' | 'instagram' | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') return 'facebook';
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) return 'instagram';
    return null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: unknown, maxLength: number = 4096): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString().slice(0, maxLength);
  } catch {
    return undefined;
  }
}

function safePublishedAt(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const millis = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(millis)) return undefined;
  const normalizedMillis = millis < 10_000_000_000 ? millis * 1000 : millis;
  if (normalizedMillis > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return new Date(normalizedMillis).toISOString();
}

function bearerHeaders(token: string, json: boolean = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

/**
 * Real Apify Cloud Connector for optional public Facebook/Instagram monitoring.
 * Operator credentials stay in Authorization headers and are never copied into URLs.
 */
export class ApifyConnector implements ISourceConnector {
  readonly providerName = 'Apify Cloud';
  private apiToken: string | null = null;
  private readonly baseUrl = 'https://api.apify.com/v2';

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
    if (!token) return { ok: false, latencyMs: 0, message: 'APIFY_API_TOKEN is not configured.' };

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/users/me`, {
        headers: bearerHeaders(token),
        signal: AbortSignal.timeout(10_000)
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json() as any;
        return { ok: true, latencyMs, message: `Connected as ${data?.data?.username || 'Apify User'}` };
      }
      return { ok: false, latencyMs, message: `Apify API rejected token: HTTP ${res.status}` };
    } catch (err: any) {
      const timeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: timeout ? 'Apify health check timed out' : (err?.message || 'Network error connecting to Apify')
      };
    }
  }

  async resolveSource(input: SourceInput): Promise<ResolvedSourceResult> {
    const rawUrl = (input.url || '').trim();
    if (!rawUrl) {
      return {
        valid: false, platform: 'other', externalId: '', name: '', handle: '', url: '',
        visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
        requiresAuthentication: false, error: 'URL is required'
      };
    }

    const detectedPlatform = platformForSocialUrl(rawUrl);
    if (!detectedPlatform) {
      return {
        valid: false, platform: 'other', externalId: '', name: '', handle: '', url: rawUrl,
        visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
        requiresAuthentication: false, error: 'Only Facebook and Instagram public URLs are supported'
      };
    }

    const platform: SourcePlatform = detectedPlatform;
    const canonicalUrl = canonicalizeSocialUrl(rawUrl);
    let handle = 'page';
    try {
      const parsed = new URL(canonicalUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const first = parts[0] || '';
      if (first.toLowerCase() === 'profile.php') handle = parsed.searchParams.get('id') || 'page';
      else if (first.toLowerCase() === 'groups' && parts[1]) handle = parts[1];
      else if (['p', 'reel', 'reels', 'stories', 'posts'].includes(first.toLowerCase()) && parts[1]) handle = parts[1];
      else handle = first || 'page';
    } catch {
      return {
        valid: false, platform, externalId: '', name: '', handle: '', url: canonicalUrl,
        visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
        requiresAuthentication: false, error: 'Could not canonicalize the social URL'
      };
    }
    handle = handle.replace(/^@/, '').slice(0, 255) || 'page';

    const token = this.getToken();
    if (!token) {
      return {
        valid: false, platform, externalId: handle, name: '', handle: `@${handle}`, url: canonicalUrl,
        visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
        requiresAuthentication: false, error: 'APIFY_API_TOKEN is not configured. Add the server-side token to use the optional public provider.'
      };
    }

    try {
      const actorId = platform === 'facebook'
        ? (process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper')
        : (process.env.APIFY_IG_ACTOR || 'apify~instagram-scraper');
      const actorInput = platform === 'facebook'
        ? { startUrls: [{ url: canonicalUrl }], resultsLimit: 1 }
        : { directUrls: [canonicalUrl], resultsLimit: 1 };

      const res = await fetch(
        `${this.baseUrl}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=40`,
        {
          method: 'POST',
          headers: bearerHeaders(token, true),
          body: JSON.stringify(actorInput),
          signal: AbortSignal.timeout(45_000)
        }
      );

      if (!res.ok) {
        const errorText = (await res.text()).slice(0, 150);
        return {
          valid: false, platform, externalId: handle, name: '', handle: `@${handle}`, url: canonicalUrl,
          visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
          requiresAuthentication: false, error: `Apify Actor error (${res.status}): ${errorText}`
        };
      }

      const items = await res.json() as any;
      if (!Array.isArray(items) || items.length === 0) {
        return {
          valid: false, platform, externalId: handle, name: '', handle: `@${handle}`, url: canonicalUrl,
          visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
          requiresAuthentication: false,
          error: `No public data returned by Apify for this ${platform} URL. The page might be private or geo-restricted.`
        };
      }

      const first = items[0] || {};
      const externalId = String(first.pageId || first.ownerId || handle).trim().slice(0, 255) || handle;
      const realName = String(first.pageName || first.ownerFullName || first.authorName || '').trim().slice(0, 255);
      const ownerUsername = String(first.ownerUsername || handle).trim().replace(/^@/, '').slice(0, 255) || handle;
      if (!realName) {
        return {
          valid: false, platform, externalId, name: '', handle: `@${ownerUsername}`, url: canonicalUrl,
          visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
          requiresAuthentication: false, error: 'Apify did not return reliable source identity metadata'
        };
      }

      return {
        valid: true,
        platform,
        externalId,
        name: realName,
        handle: `@${ownerUsername}`,
        avatarUrl: safeHttpsUrl(first.profilePicUrl || first.profilePicture || first.pageImage || first.ownerProfilePicUrl),
        url: canonicalUrl,
        bio: typeof (first.biography || first.pageBio || first.bio) === 'string'
          ? String(first.biography || first.pageBio || first.bio).trim().slice(0, 5000)
          : undefined,
        visibilityType: 'public',
        connectorType: 'public_cloud',
        connectorStatus: 'connected',
        requiresAuthentication: false
      };
    } catch (err: any) {
      const timeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      return {
        valid: false, platform, externalId: handle, name: '', handle: `@${handle}`, url: canonicalUrl,
        visibilityType: 'public', connectorType: 'public_cloud', connectorStatus: 'error',
        requiresAuthentication: false,
        error: `Apify execution failed: ${timeout ? 'Request timed out' : (err?.message || 'Unknown provider error')}`
      };
    }
  }

  async fetchLatestPosts(source: {
    id: string;
    url: string;
    platform: SourcePlatform;
    externalId: string;
  }): Promise<RawProviderPost[]> {
    const token = this.getToken();
    if (!token) throw new Error('APIFY_API_TOKEN is not configured on the server.');
    if (source.platform !== 'facebook' && source.platform !== 'instagram') throw new Error('Unsupported source platform');
    if (platformForSocialUrl(source.url) !== source.platform) throw new Error('Source URL does not match source platform');

    const platform = source.platform;
    const canonicalSourceUrl = canonicalizeSocialUrl(source.url);
    const actorId = platform === 'facebook'
      ? (process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper')
      : (process.env.APIFY_IG_ACTOR || 'apify~instagram-scraper');
    const actorInput = platform === 'facebook'
      ? { startUrls: [{ url: canonicalSourceUrl }], resultsLimit: 5 }
      : { directUrls: [canonicalSourceUrl], resultsLimit: 5 };

    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=55`,
        {
          method: 'POST',
          headers: bearerHeaders(token, true),
          body: JSON.stringify(actorInput),
          signal: AbortSignal.timeout(60_000)
        }
      );
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new Error('Apify scraping request timed out');
      throw err;
    }

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 150);
      throw new Error(`Apify scraping error (HTTP ${res.status}): ${errText}`);
    }

    const items = await res.json() as any;
    if (!Array.isArray(items)) return [];
    const normalized: RawProviderPost[] = [];

    for (const item of items.slice(0, 5)) {
      if (!item || typeof item !== 'object') continue;
      const text = String(platform === 'facebook' ? (item.text || item.postText || item.message || '') : (item.caption || item.text || '')).trim().slice(0, 100_000);
      const rawPostUrl = platform === 'facebook'
        ? (item.url || item.postUrl || canonicalSourceUrl)
        : (item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : canonicalSourceUrl));
      const postUrl = typeof rawPostUrl === 'string' && platformForSocialUrl(rawPostUrl) === platform
        ? canonicalizeSocialUrl(rawPostUrl)
        : canonicalSourceUrl;
      const externalIdRaw = platform === 'facebook'
        ? (item.postId || item.id || (postUrl !== canonicalSourceUrl ? postUrl : undefined))
        : (item.id || item.shortCode);
      const externalId = externalIdRaw === undefined || externalIdRaw === null ? undefined : String(externalIdRaw).trim().slice(0, 512) || undefined;
      const mediaUrls: { type: 'image' | 'video'; url: string }[] = [];
      const addMedia = (type: 'image' | 'video', raw: unknown) => {
        const url = safeHttpsUrl(raw);
        if (!url || mediaUrls.some(item => item.url === url)) return;
        mediaUrls.push({ type, url });
      };

      if (platform === 'facebook') {
        if (Array.isArray(item.images)) item.images.slice(0, 20).forEach((img: any) => addMedia('image', typeof img === 'string' ? img : img?.url));
        if (item.mediaUrl) addMedia(item.isVideo ? 'video' : 'image', item.mediaUrl);
      } else {
        if (item.displayUrl) addMedia(item.isVideo ? 'video' : 'image', item.displayUrl);
        if (Array.isArray(item.images)) item.images.slice(0, 20).forEach((img: any) => addMedia('image', typeof img === 'string' ? img : img?.url));
      }

      if (!text && mediaUrls.length === 0) continue;
      const publishedAt = safePublishedAt(platform === 'facebook' ? (item.time || item.publishedAt || item.timestamp) : item.timestamp);
      normalized.push({
        id: `${platform === 'facebook' ? 'post_fb' : 'post_ig'}_${externalId || Math.random().toString(36).slice(2, 10)}`,
        externalId,
        url: postUrl,
        authorName: String(platform === 'facebook' ? (item.pageName || '') : (item.ownerFullName || item.ownerUsername || '')).trim().slice(0, 255) || undefined,
        authorAvatar: safeHttpsUrl(platform === 'facebook' ? item.profilePicture : item.ownerProfilePicUrl),
        text,
        media: mediaUrls.slice(0, 20),
        publishedAt,
        metadata: { apifyActor: actorId }
      });
    }

    return normalized;
  }
}
