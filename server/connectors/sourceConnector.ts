import { 
  ISourceConnector, 
  SourceInput, 
  ResolvedSourceResult, 
  RawProviderPost, 
  SourcePlatform 
} from './types';
import { ApifyConnector } from './apifyConnector';
import { PublicMetaResolver } from './metaResolver';

export class SourceConnectorManager {
  private apifyConnector: ApifyConnector;
  private metaResolver: PublicMetaResolver;

  constructor() {
    this.apifyConnector = new ApifyConnector();
    this.metaResolver = new PublicMetaResolver();
  }

  isApifyConfigured(): boolean {
    return this.apifyConnector.isConfigured();
  }

  async resolve(input: SourceInput, isDemoMode: boolean = false): Promise<ResolvedSourceResult> {
    const rawUrl = (input.url || '').trim();

    // 1. In demo mode only, if explicit demo is requested
    if (isDemoMode) {
      const isFb = rawUrl.includes('facebook.com');
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

    // 2. Production Mode: Attempt real resolution
    // First, try fast direct Meta OpenGraph resolution to get real page name and real avatar
    try {
      const metaResult = await this.metaResolver.resolve(input);
      if (metaResult && metaResult.valid && metaResult.name) {
        return metaResult;
      }
    } catch (e) {
      // Continue to Apify
    }

    // Second, try Apify if configured
    if (this.apifyConnector.isConfigured()) {
      const apifyResult = await this.apifyConnector.resolveSource(input);
      if (apifyResult.valid) {
        return apifyResult;
      }
      // If Apify gave a specific error, return it
      if (apifyResult.error) {
        return apifyResult;
      }
    }

    // If both failed in production mode: NEVER invent fake content
    return {
      valid: false,
      platform: rawUrl.includes('instagram.com') ? 'instagram' : 'facebook',
      externalId: '',
      name: '',
      handle: '',
      url: rawUrl,
      visibilityType: 'public',
      connectorType: 'public_cloud',
      connectorStatus: 'error',
      requiresAuthentication: false,
      error: this.apifyConnector.isConfigured()
        ? 'Could not resolve public page details from Facebook/Instagram. Please check the URL and ensure the page is public.'
        : 'APIFY_API_TOKEN is not configured on the server, and direct public page metadata was blocked by the platform. Please provide APIFY_API_TOKEN in Settings.'
    };
  }

  async fetchLatest(source: { 
    id: string; 
    url: string; 
    platform: SourcePlatform; 
    externalId: string 
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

    if (!this.apifyConnector.isConfigured()) {
      throw new Error('APIFY_API_TOKEN is not configured. Cannot fetch live posts in production mode.');
    }

    return await this.apifyConnector.fetchLatestPosts(source);
  }
}

export const sourceConnectorManager = new SourceConnectorManager();
