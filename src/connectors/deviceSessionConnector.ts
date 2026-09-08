import { Capacitor, registerPlugin } from '@capacitor/core';
import { SourceConnector, SourceInput, ValidationResult, ResolvedSource, ConnectorHealth } from './types';
import { NormalizedPost, SourcePlatform } from '../types';
import { ensureApiDeviceAuth } from '../services/api';

export interface NativeSessionStatus {
  available: boolean;
  connected: boolean;
  facebookConnected?: boolean;
  instagramConnected?: boolean;
  facebookConnectedAt?: string;
  instagramConnectedAt?: string;
  connectedAt?: string;
  lastCheckedAt?: string;
  message?: string;
}

interface NativeResolvedSource {
  platform: 'facebook' | 'instagram';
  externalId: string;
  url: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  bio?: string;
  visibilityType?: 'public' | 'authenticated';
}

interface NativeCollectedPost {
  externalPostId?: string;
  originalUrl: string;
  authorName?: string;
  authorAvatar?: string;
  text?: string;
  media?: { type: 'image' | 'video'; url: string }[];
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}

interface AuthenticatedSocialSessionPlugin {
  status(): Promise<NativeSessionStatus>;
  readClipboard(): Promise<{ text?: string }>;
  connectFacebook(): Promise<{ opened: boolean; connected?: boolean; cancelled?: boolean }>;
  connectInstagram(): Promise<{ opened: boolean; connected?: boolean; cancelled?: boolean }>;
  disconnectFacebook(): Promise<{ disconnected: boolean }>;
  disconnectInstagram(): Promise<{ disconnected: boolean }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  saveBackendAuth(options: { userId: string; deviceId: string; token: string; platform: string }): Promise<{ saved: boolean }>;
  getBackendAuth(): Promise<{ configured: boolean; userId?: string; deviceId?: string; token?: string; platform?: string }>;
  clearBackendAuth(): Promise<{ cleared: boolean }>;
  resolveSource(options: { url: string }): Promise<NativeResolvedSource>;
  collectSource(options: { sourceId: string; url: string; platform: string; limit?: number }): Promise<{ posts: NativeCollectedPost[]; checkedAt: string; requestedLimit?: number }>;
  scheduleSource(options: { sourceId: string; url: string; platform: string; backendBaseUrl: string }): Promise<{ scheduled: boolean; minimumIntervalMinutes: number }>;
  cancelSource(options: { sourceId: string }): Promise<{ cancelled: boolean }>;
}

const NativeSession = registerPlugin<AuthenticatedSocialSessionPlugin>('AuthenticatedSocialSession');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function clampPostLimit(limit: number): number {
  return Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 10));
}

function toNormalizedPost(source: { id: string; platform: SourcePlatform; url: string; externalId: string }, post: NativeCollectedPost): NormalizedPost {
  const detectedAt = new Date().toISOString();
  return {
    id: post.externalPostId || `${source.id}:${post.originalUrl}`,
    sourceId: source.id,
    platform: source.platform,
    externalPostId: post.externalPostId,
    originalUrl: post.originalUrl,
    authorName: post.authorName || source.externalId,
    authorAvatar: post.authorAvatar,
    text: post.text || '',
    media: Array.isArray(post.media) ? post.media : [],
    publishedAt: post.publishedAt || '',
    detectedAt,
    fingerprint: post.externalPostId || post.originalUrl,
    metadata: { ...(post.metadata || {}), ingestion: 'android_device_session' }
  };
}

export class DeviceSessionConnector implements SourceConnector {
  static isNativeAvailable(): boolean {
    return isAndroidNative();
  }

  static async getLocalSession(): Promise<NativeSessionStatus> {
    if (!isAndroidNative()) {
      return { available: false, connected: false, facebookConnected: false, instagramConnected: false };
    }
    const status = await NativeSession.status();
    return {
      ...status,
      facebookConnected: status.facebookConnected ?? status.connected,
      // Old APKs only exposed a Facebook-only `connected`; never treat that as Instagram auth.
      instagramConnected: status.instagramConnected ?? false
    };
  }

  static isPlatformConnected(status: NativeSessionStatus, platform: SourcePlatform | null | undefined): boolean {
    if (platform === 'instagram') return status.instagramConnected === true;
    if (platform === 'facebook') return status.facebookConnected === true;
    return false;
  }

  static async readClipboardText(): Promise<string> {
    if (!isAndroidNative()) return '';
    const result = await NativeSession.readClipboard();
    return typeof result?.text === 'string' ? result.text : '';
  }

  static async connectFacebook(): Promise<boolean> {
    if (!isAndroidNative()) throw new Error('Facebook connection requires the Android app.');
    await NativeSession.connectFacebook();
    return DeviceSessionConnector.isPlatformConnected(await DeviceSessionConnector.getLocalSession(), 'facebook');
  }

  static async connectInstagram(): Promise<boolean> {
    if (!isAndroidNative()) throw new Error('Instagram connection requires the Android app.');
    await NativeSession.connectInstagram();
    return DeviceSessionConnector.isPlatformConnected(await DeviceSessionConnector.getLocalSession(), 'instagram');
  }

  static async disconnectFacebook(): Promise<void> {
    if (!isAndroidNative()) return;
    await NativeSession.disconnectFacebook();
  }

  static async disconnectInstagram(): Promise<void> {
    if (!isAndroidNative()) return;
    await NativeSession.disconnectInstagram();
  }

  static async wipeLocalSession(): Promise<void> {
    if (!isAndroidNative()) return;
    await NativeSession.disconnect();
  }

  static async scheduleBackgroundSource(source: { id: string; url: string; platform: SourcePlatform }, backendBaseUrl: string): Promise<void> {
    if (!isAndroidNative()) throw new Error('Background authenticated monitoring requires the Android app.');
    const auth = await ensureApiDeviceAuth();
    await NativeSession.saveBackendAuth({ userId: auth.userId, deviceId: auth.deviceId, token: auth.token, platform: auth.platform });
    await NativeSession.scheduleSource({ sourceId: source.id, url: source.url, platform: source.platform, backendBaseUrl });
  }

  static async cancelBackgroundSource(sourceId: string): Promise<void> {
    if (!isAndroidNative()) return;
    await NativeSession.cancelSource({ sourceId });
  }

  async validate(input: SourceInput): Promise<ValidationResult> {
    const raw = (input.url || '').trim();
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const isFacebook = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
      const isInstagram = host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
      if (!['http:', 'https:'].includes(parsed.protocol) || (!isFacebook && !isInstagram)) {
        return { valid: false, platform: 'other', cleanedUrl: raw, handleOrId: '', isPostUrl: false, error: 'Only Facebook and Instagram URLs are supported.' };
      }
      parsed.hash = '';
      const segments = parsed.pathname.split('/').filter(Boolean);
      return {
        valid: true,
        platform: isInstagram ? 'instagram' : 'facebook',
        cleanedUrl: parsed.toString(),
        handleOrId: segments[0] || '',
        isPostUrl: /\/(posts|reel|reels|p|permalink)\//i.test(parsed.pathname)
      };
    } catch {
      return { valid: false, platform: 'other', cleanedUrl: raw, handleOrId: '', isPostUrl: false, error: 'Invalid URL' };
    }
  }

  async resolveSource(input: SourceInput): Promise<ResolvedSource> {
    const validation = await this.validate(input);
    if (!validation.valid) throw new Error(validation.error || 'Invalid source URL');
    if (!isAndroidNative()) throw new Error('This source requires the Android app.');
    const status = await DeviceSessionConnector.getLocalSession();
    if (!DeviceSessionConnector.isPlatformConnected(status, validation.platform)) {
      throw new Error(`${validation.platform === 'instagram' ? 'Instagram' : 'Facebook'} session is not connected.`);
    }
    const resolved = await NativeSession.resolveSource({ url: validation.cleanedUrl });
    return {
      platform: resolved.platform,
      externalId: resolved.externalId,
      url: resolved.url,
      displayName: resolved.displayName,
      handle: resolved.handle || '',
      avatarUrl: resolved.avatarUrl || '',
      bio: resolved.bio || '',
      visibilityType: resolved.visibilityType || 'authenticated',
      connectorType: 'device_session',
      connectorStatus: 'authenticated_monitoring',
      samplePosts: []
    };
  }

  async fetchLatest(
    source: { id: string; url: string; platform: SourcePlatform; externalId: string },
    limit: number = 10
  ): Promise<NormalizedPost[]> {
    if (!isAndroidNative()) throw new Error('Authenticated source collection requires the Android app.');
    const status = await DeviceSessionConnector.getLocalSession();
    if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) {
      throw new Error(`${source.platform === 'instagram' ? 'Instagram' : 'Facebook'} session expired or is not connected.`);
    }
    const result = await NativeSession.collectSource({
      sourceId: source.id,
      url: source.url,
      platform: source.platform,
      limit: clampPostLimit(limit)
    });
    return (result.posts || []).map(post => toNormalizedPost(source, post));
  }

  async healthCheck(source: { id: string; url: string; platform: SourcePlatform }): Promise<ConnectorHealth> {
    const startedAt = performance.now();
    const status = await DeviceSessionConnector.getLocalSession();
    const connected = DeviceSessionConnector.isPlatformConnected(status, source.platform);
    return {
      status: connected ? 'authenticated_monitoring' : 'needs_relogin',
      latencyMs: Math.round(performance.now() - startedAt),
      lastSuccessfulCheck: status.lastCheckedAt || (source.platform === 'instagram' ? status.instagramConnectedAt : status.facebookConnectedAt) || 'Never',
      errorCount: connected ? 0 : 1,
      message: connected ? `${source.platform} session connected` : `${source.platform} login required`
    };
  }
}
