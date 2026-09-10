import { Capacitor, registerPlugin } from '@capacitor/core';
import { SourceConnector, SourceInput, ValidationResult, ResolvedSource, ConnectorHealth } from './types';
import { NormalizedPost, SocialComment, SourcePlatform } from '../types';
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

export type CommentGrabMode = 'none' | 'publisher' | 'top' | 'all';

export interface GrabDetailOptions {
  commentsMode?: CommentGrabMode;
  commentLimit?: number;
  includeReplies?: boolean;
  includeMedia?: boolean;
}

interface NativeCollectedComment {
  externalCommentId?: string;
  authorName?: string;
  authorUrl?: string;
  authorAvatar?: string;
  text?: string;
  publishedLabel?: string;
  originalUrl?: string;
  isPublisher?: boolean;
  depth?: number;
  media?: { type: 'image' | 'video'; url: string }[];
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
  collectPostDetails(options: {
    url: string;
    sourceUrl: string;
    platform: string;
    publisherName?: string;
    commentsMode: CommentGrabMode;
    commentLimit: number;
    includeReplies: boolean;
  }): Promise<{
    comments?: NativeCollectedComment[];
    commentsTruncated?: boolean;
    media?: { type: 'image' | 'video'; url: string }[];
    videoPresent?: boolean;
    checkedAt?: string;
    diagnostics?: Record<string, unknown>;
  }>;
  scheduleSource(options: { sourceId: string; url: string; platform: string; backendBaseUrl: string; locale: 'ar' | 'en' }): Promise<{ scheduled: boolean; minimumIntervalMinutes: number }>;
  cancelSource(options: { sourceId: string }): Promise<{ cancelled: boolean }>;
}

const NativeSession = registerPlugin<AuthenticatedSocialSessionPlugin>('AuthenticatedSocialSession');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function clampPostLimit(limit: number): number {
  return Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 10));
}

function clampCommentLimit(limit: number | undefined, mode: CommentGrabMode): number {
  if (mode === 'none') return 0;
  const fallback = mode === 'all' ? 200 : 20;
  const numeric = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.max(1, Math.min(200, numeric));
}

function normalizeComment(raw: NativeCollectedComment): SocialComment | null {
  const authorName = typeof raw?.authorName === 'string' ? raw.authorName.trim().slice(0, 255) : '';
  const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, 5000) : '';
  if (!authorName || !text) return null;
  const media = Array.isArray(raw.media)
    ? raw.media.filter(item => item && (item.type === 'image' || item.type === 'video') && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)).slice(0, 4)
    : [];
  return {
    externalCommentId: typeof raw.externalCommentId === 'string' ? raw.externalCommentId.slice(0, 512) : undefined,
    authorName,
    authorUrl: typeof raw.authorUrl === 'string' && /^https?:\/\//i.test(raw.authorUrl) ? raw.authorUrl : undefined,
    authorAvatar: typeof raw.authorAvatar === 'string' && /^https?:\/\//i.test(raw.authorAvatar) ? raw.authorAvatar : undefined,
    text,
    publishedLabel: typeof raw.publishedLabel === 'string' ? raw.publishedLabel.slice(0, 200) : undefined,
    originalUrl: typeof raw.originalUrl === 'string' && /^https?:\/\//i.test(raw.originalUrl) ? raw.originalUrl : undefined,
    isPublisher: raw.isPublisher === true,
    depth: Math.max(0, Math.min(4, Number(raw.depth) || 0)),
    media
  };
}

function mergeMedia(base: NormalizedPost['media'], detail: { type: 'image' | 'video'; url: string }[] | undefined): NormalizedPost['media'] {
  const seen = new Set<string>();
  const output: NormalizedPost['media'] = [];
  for (const item of [...(base || []), ...(Array.isArray(detail) ? detail : [])]) {
    if (!item || (item.type !== 'image' && item.type !== 'video') || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    output.push({ type: item.type, url: item.url });
    if (output.length >= 20) break;
  }
  return output;
}

function normalizedIdentity(value?: string): string {
  return (value || '').trim().replace(/^@/, '').toLowerCase();
}

function isGenericIdentityName(value: string | undefined, externalId: string): boolean {
  const name = normalizedIdentity(value);
  const id = normalizedIdentity(externalId);
  return !name || name === id || ['facebook', 'instagram', 'page', 'profile'].includes(name);
}

function toNormalizedPost(source: { id: string; platform: SourcePlatform; url: string; externalId: string; displayName?: string; avatarUrl?: string }, post: NativeCollectedPost): NormalizedPost {
  const detectedAt = new Date().toISOString();
  return {
    id: post.externalPostId || `${source.id}:${post.originalUrl}`,
    sourceId: source.id,
    platform: source.platform,
    externalPostId: post.externalPostId,
    originalUrl: post.originalUrl,
    authorName: !isGenericIdentityName(post.authorName, source.externalId)
      ? post.authorName!.trim()
      : (!isGenericIdentityName(source.displayName, source.externalId) ? source.displayName!.trim() : source.externalId),
    authorAvatar: post.authorAvatar || source.avatarUrl,
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

  static async clearBackendDeviceAuth(): Promise<void> {
    if (!isAndroidNative()) return;
    await NativeSession.clearBackendAuth();
  }

  static async scheduleBackgroundSource(
    source: { id: string; url: string; platform: SourcePlatform },
    backendBaseUrl: string,
    locale: 'ar' | 'en' = 'en'
  ): Promise<void> {
    if (!isAndroidNative()) throw new Error('Background authenticated monitoring requires the Android app.');
    const auth = await ensureApiDeviceAuth();
    await NativeSession.saveBackendAuth({ userId: auth.userId, deviceId: auth.deviceId, token: auth.token, platform: auth.platform });
    await NativeSession.scheduleSource({ sourceId: source.id, url: source.url, platform: source.platform, backendBaseUrl, locale });
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
    source: { id: string; url: string; platform: SourcePlatform; externalId: string; displayName?: string; avatarUrl?: string },
    limit: number = 10,
    detailOptions: GrabDetailOptions = {}
  ): Promise<NormalizedPost[]> {
    if (!isAndroidNative()) throw new Error('Authenticated source collection requires the Android app.');
    const status = await DeviceSessionConnector.getLocalSession();
    if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) {
      throw new Error(`${source.platform === 'instagram' ? 'Instagram' : 'Facebook'} session expired or is not connected.`);
    }
    let normalizedSource = source;
    const needsIdentity = isGenericIdentityName(source.displayName, source.externalId) || !source.avatarUrl?.trim();
    if (needsIdentity) {
      try {
        const resolved = await this.resolveSource({ url: source.url });
        normalizedSource = {
          ...source,
          externalId: resolved.externalId || source.externalId,
          displayName: resolved.displayName || source.displayName,
          avatarUrl: resolved.avatarUrl || source.avatarUrl
        };
      } catch { /* collection remains usable even if metadata enrichment is unavailable */ }
    }

    const result = await NativeSession.collectSource({
      sourceId: source.id,
      url: source.url,
      platform: source.platform,
      limit: clampPostLimit(limit)
    });
    const posts = (result.posts || []).map(post => toNormalizedPost(normalizedSource, post));
    const commentsMode: CommentGrabMode = ['publisher', 'top', 'all'].includes(detailOptions.commentsMode || '')
      ? detailOptions.commentsMode as CommentGrabMode
      : 'none';
    const includeMedia = detailOptions.includeMedia === true;
    if ((!includeMedia && commentsMode === 'none') || posts.length === 0) return posts;

    const commentLimit = clampCommentLimit(detailOptions.commentLimit, commentsMode);
    const includeReplies = detailOptions.includeReplies !== false;
    const maxDetailedPosts = commentsMode === 'all' ? 5 : 20;
    if (posts.length > maxDetailedPosts) {
      throw new Error(commentsMode === 'all'
        ? 'All-comment collection is limited to 5 posts per operation.'
        : 'Comment collection is limited to 20 posts per operation.');
    }

    let successfulDetails = 0;
    for (const post of posts) {
      try {
        const detail = await NativeSession.collectPostDetails({
          url: post.originalUrl,
          sourceUrl: source.url,
          platform: source.platform,
          publisherName: post.authorName || normalizedSource.displayName || normalizedSource.externalId,
          commentsMode,
          commentLimit,
          includeReplies
        });
        const comments = Array.isArray(detail.comments)
          ? detail.comments.map(normalizeComment).filter((comment): comment is SocialComment => Boolean(comment)).slice(0, commentLimit)
          : [];
        post.comments = comments;
        post.commentsTruncated = detail.commentsTruncated === true;
        post.videoPresent = detail.videoPresent === true || post.media.some(item => item.type === 'video');
        post.media = mergeMedia(post.media, detail.media);
        post.metadata = {
          ...post.metadata,
          detailCollection: 'authenticated_post_detail',
          detailAvailable: true,
          commentCount: comments.length,
          commentsTruncated: post.commentsTruncated,
          videoPresent: post.videoPresent
        };
        successfulDetails++;
      } catch (error: any) {
        post.metadata = {
          ...post.metadata,
          detailCollection: 'authenticated_post_detail',
          detailAvailable: false,
          detailError: String(error?.message || 'Post detail collection failed').slice(0, 300)
        };
      }
    }

    if (successfulDetails === 0 && commentsMode !== 'none') {
      throw new Error('Posts were found, but authenticated comment/media details could not be collected right now.');
    }
    return posts;
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
