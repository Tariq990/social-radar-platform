import { SourceConnector, SourceInput, ValidationResult, ResolvedSource, ConnectorHealth } from './types';
import { NormalizedPost, SourcePlatform } from '../types';

function supportedPlatform(hostname: string): 'facebook' | 'instagram' | null {
  const host = hostname.toLowerCase();
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') {
    return 'facebook';
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) {
    return 'instagram';
  }
  return null;
}

/**
 * Legacy client-side public connector facade.
 *
 * Real public-provider credentials and scraping run server-side only. This class deliberately
 * fails closed instead of manufacturing identities/posts when no authenticated Android session
 * or configured server-side provider is available.
 */
export class PublicCloudConnector implements SourceConnector {
  async validate(input: SourceInput): Promise<ValidationResult> {
    const raw = (input.url || '').trim();
    if (!raw) {
      return { valid: false, platform: 'other', cleanedUrl: '', handleOrId: '', isPostUrl: false, error: 'Empty URL' };
    }

    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, platform: 'other', cleanedUrl: raw, handleOrId: '', isPostUrl: false, error: 'Only HTTPS Facebook and Instagram URLs are supported.' };
      }
      const platform = supportedPlatform(parsed.hostname);
      if (!platform) {
        return { valid: false, platform: 'other', cleanedUrl: raw, handleOrId: '', isPostUrl: false, error: 'Only Facebook and Instagram URLs are supported.' };
      }
      if (parsed.protocol === 'http:') parsed.protocol = 'https:';
      parsed.hash = '';
      const segments = parsed.pathname.split('/').filter(Boolean);
      const first = segments[0] || '';
      const generic = new Set(['p', 'reel', 'reels', 'posts', 'permalink', 'permalink.php', 'story.php', 'photo', 'photo.php', 'watch', 'share', 'videos']);
      const handleOrId = first.toLowerCase() === 'profile.php'
        ? (parsed.searchParams.get('id') || '')
        : first.toLowerCase() === 'groups' && segments[1]
          ? segments[1]
          : first && !generic.has(first.toLowerCase())
            ? first
            : (parsed.searchParams.get('id') || '');
      return {
        valid: true,
        platform,
        cleanedUrl: parsed.toString(),
        handleOrId: handleOrId.replace(/^@/, ''),
        isPostUrl: /\/(posts|reel|reels|p|permalink|photo|photos|videos)\b/i.test(parsed.pathname) || parsed.pathname.toLowerCase().includes('story.php')
      };
    } catch {
      return { valid: false, platform: 'other', cleanedUrl: raw, handleOrId: '', isPostUrl: false, error: 'Invalid URL' };
    }
  }

  async resolveSource(input: SourceInput): Promise<ResolvedSource> {
    const validation = await this.validate(input);
    if (!validation.valid) throw new Error(validation.error || 'Invalid source URL');
    throw new Error('Client-side public source resolution is disabled. Use the authenticated Android device session or a configured server-side provider.');
  }

  async fetchLatest(_source: { id: string; url: string; platform: SourcePlatform; externalId: string }): Promise<NormalizedPost[]> {
    throw new Error('Client-side public monitoring is disabled. Real public-provider collection runs server-side only when explicitly configured.');
  }

  async healthCheck(_source: { id: string; url: string; platform: SourcePlatform }): Promise<ConnectorHealth> {
    return {
      status: 'unsupported',
      latencyMs: 0,
      lastSuccessfulCheck: '',
      errorCount: 0,
      message: 'Client-side public monitoring is disabled; use an authenticated Android session or the configured server provider.'
    };
  }
}
