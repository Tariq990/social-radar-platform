import {
  SourceInput,
  ResolvedSourceResult,
  RawProviderPost,
  SourcePlatform,
  ConnectorType
} from './types';
import { ApifyConnector } from './apifyConnector';
import { PublicMetaResolver } from './metaResolver';

function detectSourcePlatform(rawUrl: string): SourcePlatform {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'other';
    const host = parsed.hostname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) return 'instagram';
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') return 'facebook';
  } catch {
    return 'other';
  }
  return 'other';
}

/**
 * Server-side connector manager.
 *
 * The primary production architecture is the authenticated Android device connector.
 * The server can still resolve publicly exposed metadata, and an external public provider
 * may be enabled explicitly as an optional adapter. It is never required by default.
 */
export class SourceConnectorManager {
  private readonly apifyConnector = new ApifyConnector();
  private readonly metaResolver = new PublicMetaResolver();

  private optionalPublicProviderEnabled(): boolean {
    return (process.env.PUBLIC_PROVIDER || '').trim().toLowerCase() === 'apify' && this.apifyConnector.isConfigured();
  }

  isApifyConfigured(): boolean {
    return this.optionalPublicProviderEnabled();
  }

  getPrimaryMonitoringMode(): 'device_session' | 'optional_public_provider' {
    return this.optionalPublicProviderEnabled() ? 'optional_public_provider' : 'device_session';
  }

  async resolve(input: SourceInput, isDemoMode: boolean = false): Promise<ResolvedSourceResult> {
    const rawUrl = (input.url || '').trim();
    if (!rawUrl) {
      return {
        valid: false,
        platform: 'other',
        externalId: '',
        name: '',
        handle: '',
        url: '',
        visibilityType: 'authenticated',
        connectorType: 'device_session',
        connectorStatus: 'error',
        requiresAuthentication: true,
        error: 'Source URL is required'
      };
    }

    if (isDemoMode) {
      const demoPlatform = detectSourcePlatform(rawUrl);
      if (demoPlatform === 'other') {
        return {
          valid: false, platform: 'other', externalId: '', name: '', handle: '', url: '',
          visibilityType: 'authenticated', connectorType: 'device_session', connectorStatus: 'error',
          requiresAuthentication: true, error: 'Only Facebook and Instagram sources are supported in this phase.'
        };
      }
      const isFb = demoPlatform === 'facebook';
      return {
        valid: true,
        platform: isFb ? 'facebook' : 'instagram',
        externalId: 'demo_source',
        name: isFb ? 'Demo Tech Page' : 'demo.style',
        handle: isFb ? '@demotech' : '@demo.style',
        avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
        url: rawUrl,
        bio: 'Demonstration account for testing.',
        visibilityType: 'public',
        connectorType: 'public_cloud',
        connectorStatus: 'connected',
        requiresAuthentication: false
      };
    }

    const platform: SourcePlatform = detectSourcePlatform(rawUrl);
    if (platform === 'other') {
      return {
        valid: false,
        platform,
        externalId: '',
        name: '',
        handle: '',
        url: rawUrl,
        visibilityType: 'authenticated',
        connectorType: 'device_session',
        connectorStatus: 'error',
        requiresAuthentication: true,
        error: 'Only Facebook and Instagram sources are supported in this phase.'
      };
    }

    // Best-effort public metadata resolution. This does not imply that the server can
    // continuously monitor the source. Monitoring still belongs to the device session
    // unless an optional public provider was explicitly enabled by the operator.
    try {
      const metaResult = await this.metaResolver.resolve(input);
      if (metaResult?.valid && metaResult.name) {
        if (this.optionalPublicProviderEnabled()) {
          return {
            ...metaResult,
            connectorType: 'public_cloud',
            connectorStatus: 'connected',
            requiresAuthentication: false
          };
        }

        return {
          ...metaResult,
          visibilityType: 'authenticated',
          connectorType: 'device_session',
          connectorStatus: 'needs_relogin',
          requiresAuthentication: true
        };
      }
    } catch {
      // Device resolution is the next supported path.
    }

    // Optional operator-selected public provider. Never required by default.
    if (this.optionalPublicProviderEnabled()) {
      const providerResult = await this.apifyConnector.resolveSource(input);
      if (providerResult.valid || providerResult.error) return providerResult;
    }

    // The authenticated Android device must resolve the source using the user's own
    // local Facebook/Instagram session. Returning this state is not an error/fake success.
    return {
      valid: false,
      platform,
      externalId: '',
      name: '',
      handle: '',
      url: rawUrl,
      visibilityType: 'authenticated',
      connectorType: 'device_session',
      connectorStatus: 'needs_relogin',
      requiresAuthentication: true,
      error: 'This source requires resolution from a connected Android device session.'
    };
  }

  async fetchLatest(source: {
    id: string;
    url: string;
    platform: SourcePlatform;
    externalId: string;
    connectorType?: ConnectorType;
  }, isDemoMode: boolean = false): Promise<RawProviderPost[]> {
    if (isDemoMode) {
      return [
        {
          id: `demo_post_${Date.now()}`,
          url: source.url,
          text: 'Demo post: Limited-time 30% discount on all premium monitors today!',
          publishedAt: new Date().toISOString()
        }
      ];
    }

    if (source.connectorType === 'device_session' || !source.connectorType) {
      throw new Error('DEVICE_SESSION_SOURCE: authenticated sources are collected on the connected Android device and ingested through /api/device/ingest.');
    }

    if (source.connectorType === 'public_cloud' && this.optionalPublicProviderEnabled()) {
      return await this.apifyConnector.fetchLatestPosts(source);
    }

    throw new Error('No server-side provider is configured for this source. Connect an Android device session.');
  }
}

export const sourceConnectorManager = new SourceConnectorManager();
