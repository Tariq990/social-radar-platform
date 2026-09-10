import { Capacitor, registerPlugin } from '@capacitor/core';
import { SourceConnector, SourceInput, ValidationResult, ResolvedSource, ConnectorHealth } from './types';
import { NormalizedPost, SocialComment, SourcePlatform } from '../types';
import { sanitizeTransportMetadata } from '../lib/privacy';
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

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeSocialUrl(value: unknown, platform: SourcePlatform): string | undefined {
  const normalized = safeHttpsUrl(value);
  if (!normalized || (platform !== 'facebook' && platform !== 'instagram')) return undefined;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    const facebook = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
    const instagram = host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
    return (platform === 'facebook' ? facebook : instagram) ? normalized : undefined;
  } catch {
    return undefined;
  }
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
    ? raw.media.flatMap(item => {
        if (!item || (item.type !== 'image' && item.type !== 'video')) return [];
        const url = safeHttpsUrl(item.url);
        return url ? [{ type: item.type, url }] : [];
      }).slice(0, 4)
    : [];
  return {
    externalCommentId: typeof raw.externalCommentId === 'string' ? raw.externalCommentId.slice(0, 512) : undefined,
    authorName,
    authorUrl: safeHttpsUrl(raw.authorUrl),
    authorAvatar: safeHttpsUrl(raw.authorAvatar),
    text,
    publishedLabel: typeof raw.publishedLabel === 'string' ? raw.publishedLabel.slice(0, 200) : undefined,
    originalUrl: safeHttpsUrl(raw.originalUrl),
    isPublisher: raw.isPublisher === true,
    depth: Math.max(0, Math.min(4, Number(raw.depth) || 0)),
    media
  };
}

function mergeMedia(base: NormalizedPost['media'], detail: { type: 'image' | 'video'; url: string }[] | undefined): NormalizedPost['media'] {
  const seen = new Set<string>();
  const output: NormalizedPost['media'] = [];
  for (const item of [...(base || []), ...(Array.isArray(detail) ? detail : [])]) {
    if (!item || (item.type !== 'image' && item.type !== 'video')) continue;
    const url = safeHttpsUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ type: item.type, url });
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

function detailCollectionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/SESSION_CHECKPOINT/i.test(message)) return 'SESSION_CHECKPOINT';
  if (/SESSION_REQUIRED|session expired|session is not connected/i.test(message)) return 'SESSION_REQUIRED';
  if (/timed out|timeout/i.test(message)) return 'DETAIL_TIMEOUT';
  return 'DETAIL_COLLECTION_FAILED';
}

function toNormalizedPost(source: { id: string; platform: SourcePlatform; url: string; externalId: string; displayName?: string; avatarUrl?: string }, post: NativeCollectedPost): NormalizedPost | null {
  const originalUrl = normalizeSocialUrl(post.originalUrl, source.platform);
  if (!originalUrl) return null;
  const detectedAt = new Date().toISOString();
  return {
    id: typeof post.externalPostId === 'string' && post.externalPostId.trim() ? post.externalPostId.slice(0, 512) : `${source.id}:${originalUrl}`,
    sourceId: source.id,
    platform: source.platform,
    externalPostId: typeof post.externalPostId === 'string' ? post.externalPostId.trim().slice(0, 512) || undefined : undefined,
    originalUrl,
    authorName: !isGenericIdentityName(post.authorName, source.externalId)
      ? post.authorName!.trim().slice(0, 255)
      : (!isGenericIdentityName(source.displayName, source.externalId) ? source.displayName!.trim().slice(0, 255) : source.externalId),
    authorAvatar: safeHttpsUrl(post.authorAvatar) || safeHttpsUrl(source.avatarUrl),
    text: typeof post.text === 'string' ? post.text.slice(0, 100_000) : '',
    media: mergeMedia([], Array.isArray(post.media) ? post.media : []),
    publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt.slice(0, 255) : '',
    detectedAt,
    fingerprint: (typeof post.externalPostId === 'string' && post.externalPostId.trim()) || originalUrl,
    metadata: { ...sanitizeTransportMetadata(post.metadata), ingestion: 'android_device_session' }
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
    const sourceUrl = normalizeSocialUrl(source.url, source.platform);
    if (!sourceUrl) throw new Error('Invalid Facebook/Instagram source URL.');
    const auth = await ensureApiDeviceAuth();
    await NativeSession.saveBackendAuth({ userId: auth.userId, deviceId: auth.deviceId, token: auth.token, platform: auth.platform });
    await NativeSession.scheduleSource({ sourceId: source.id, url: sourceUrl, platform: source.platform, backendBaseUrl, locale });
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
      if (parsed.protocol === 'http:') parsed.protocol = 'https:';
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
    if (resolved.platform !== validation.platform) throw new Error('Resolved source platform does not match the requested URL.');
    const resolvedUrl = normalizeSocialUrl(resolved.url || validation.cleanedUrl, resolved.platform);
    if (!resolvedUrl) throw new Error('Resolved source returned an invalid social URL.');
    return {
      platform: resolved.platform,
      externalId: typeof resolved.externalId === 'string' ? resolved.externalId.trim().slice(0, 255) : '',
      url: resolvedUrl,
      displayName: typeof resolved.displayName === 'string' ? resolved.displayName.trim().slice(0, 255) : '',
      handle: typeof resolved.handle === 'string' ? resolved.handle.trim().replace(/^@/, '').slice(0, 255) : '',
      avatarUrl: safeHttpsUrl(resolved.avatarUrl) || '',
      bio: typeof resolved.bio === 'string' ? resolved.bio.slice(0, 5000) : '',
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
    const sourceUrl = normalizeSocialUrl(source.url, source.platform);
    if (!sourceUrl) throw new Error('Invalid Facebook/Instagram source URL.');
    const status = await DeviceSessionConnector.getLocalSession();
    if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) {
      throw new Error(`${source.platform === 'instagram' ? 'Instagram' : 'Facebook'} session expired or is not connected.`);
    }
    let normalizedSource = { ...source, url: sourceUrl, avatarUrl: safeHttpsUrl(source.avatarUrl) };
    const needsIdentity = isGenericIdentityName(source.displayName, source.externalId) || !source.avatarUrl?.trim();
    if (needsIdentity) {
      try {
        const resolved = await this.resolveSource({ url: sourceUrl });
        normalizedSource = {
          ...normalizedSource,
          externalId: resolved.externalId || source.externalId,
          displayName: resolved.displayName || source.displayName,
          avatarUrl: resolved.avatarUrl || normalizedSource.avatarUrl
        };
      } catch { /* collection remains usable even if metadata enrichment is unavailable */ }
    }

    const result = await NativeSession.collectSource({
      sourceId: source.id,
      url: sourceUrl,
      platform: source.platform,
      limit: clampPostLimit(limit)
    });
    const posts = (result.posts || [])
      .map(post => toNormalizedPost(normalizedSource, post))
      .filter((post): post is NormalizedPost => Boolean(post));
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
          sourceUrl,
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
          detailError: detailCollectionErrorCode(error)
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
