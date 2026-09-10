import { NormalizedPost, SourcePlatform } from '../types';
import { ensureApiDeviceAuth, getApiBaseUrl } from './api';

export type ExploreMode = 'filter' | 'custom' | 'auto';

export interface ExploreSourceBatch {
  sourceId: string;
  posts: NormalizedPost[];
}

export interface ExploreResultItem {
  post: NormalizedPost;
  sourceName: string;
  sourceAvatar?: string;
  relevant: boolean;
  category: string;
  confidence: number;
  reason: string;
}

export interface ExploreResponse {
  accepted: number;
  duplicates: number;
  rejected: number;
  postsAnalyzed: number;
  items: ExploreResultItem[];
}

const MAX_EXPLORE_RESPONSE_BYTES = 4 * 1024 * 1024;
const EXPLORE_TIMEOUT_MS = 180_000;

function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  if (!base) throw new Error('Android build is missing the backend origin.');
  return `${base}${path}`;
}

function normalizePlatform(value: unknown): SourcePlatform {
  return value === 'instagram' ? 'instagram' : value === 'facebook' ? 'facebook' : 'other';
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

function safeSocialUrl(value: unknown, platform: SourcePlatform): string | undefined {
  const normalized = safeHttpsUrl(value);
  if (!normalized || (platform !== 'facebook' && platform !== 'instagram')) return undefined;
  const host = new URL(normalized).hostname.toLowerCase();
  const facebook = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
  const instagram = host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
  return (platform === 'facebook' ? facebook : instagram) ? normalized : undefined;
}

function normalizeMedia(value: unknown): NormalizedPost['media'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (!item || (item.type !== 'image' && item.type !== 'video')) return [];
    const url = safeHttpsUrl(item.url);
    if (!url) return [];
    return [{ type: item.type, url }];
  }).slice(0, 20);
}

function normalizePost(raw: any): NormalizedPost {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Explore response contained a malformed post');
  }
  const platform = normalizePlatform(raw.platform);
  if (platform === 'other') throw new Error('Explore response contained an unsupported post platform');
  const originalUrl = safeSocialUrl(raw.canonical_url, platform);
  if (!originalUrl) throw new Error('Explore response contained an invalid post URL');
  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const comments = Array.isArray(metadata.exploreComments)
    ? metadata.exploreComments.flatMap((entry: any) => {
        if (!entry || typeof entry.authorName !== 'string' || typeof entry.text !== 'string') return [];
        const authorName = entry.authorName.trim().slice(0, 160);
        const text = entry.text.trim().slice(0, 700);
        if (!authorName || !text) return [];
        return [{
          authorName,
          text,
          isPublisher: entry.isPublisher === true,
          depth: Math.max(0, Math.min(4, Number(entry.depth) || 0)),
          publishedLabel: typeof entry.publishedLabel === 'string' ? entry.publishedLabel.slice(0, 120) : undefined,
          media: []
        }];
      }).slice(0, 200)
    : [];
  return {
    id: raw.id.slice(0, 1024),
    sourceId: typeof raw.source_id === 'string' ? raw.source_id.slice(0, 255) : '',
    platform,
    externalPostId: typeof raw.external_id === 'string' ? raw.external_id.slice(0, 1024) : undefined,
    originalUrl,
    authorName: typeof raw.author_name === 'string' ? raw.author_name.trim().slice(0, 255) : '',
    authorAvatar: safeHttpsUrl(raw.author_avatar),
    text: typeof raw.text === 'string' ? raw.text.slice(0, 20_000) : '',
    media: normalizeMedia(raw.media),
    comments,
    commentsTruncated: metadata.commentsTruncated === true,
    videoPresent: metadata.videoPresent === true,
    publishedAt: typeof raw.published_at === 'string' ? raw.published_at.slice(0, 100) : '',
    detectedAt: typeof raw.created_at === 'string' ? raw.created_at.slice(0, 100) : '',
    fingerprint: typeof raw.fingerprint === 'string' && raw.fingerprint ? raw.fingerprint.slice(0, 1024) : (typeof raw.external_id === 'string' && raw.external_id ? raw.external_id : originalUrl),
    metadata
  };
}

function compactText(value: string): string {
  const text = value || '';
  if (text.length <= 1700) return text;
  return `${text.slice(0, 1200)}\n[…]\n${text.slice(-450)}`;
}

function compactMedia(media: NormalizedPost['media']): NormalizedPost['media'] {
  if (!Array.isArray(media)) return [];
  for (const item of media) {
    if (!item || (item.type !== 'image' && item.type !== 'video') || typeof item.url !== 'string') continue;
    const url = safeHttpsUrl(item.url);
    if (!url || url.length > 1000) continue;
    return [{ type: item.type, url }];
  }
  return [];
}

function compactComments(comments: NormalizedPost['comments']): NonNullable<NormalizedPost['comments']> {
  if (!Array.isArray(comments)) return [];
  return comments.slice(0, 200).flatMap(comment => {
    if (!comment || typeof comment.authorName !== 'string' || typeof comment.text !== 'string') return [];
    const authorName = comment.authorName.trim().slice(0, 160);
    const text = comment.text.trim();
    if (!authorName || !text) return [];
    const compact = text.length <= 650 ? text : `${text.slice(0, 500)} […] ${text.slice(-100)}`;
    return [{
      authorName,
      text: compact,
      isPublisher: comment.isPublisher === true,
      depth: Math.max(0, Math.min(4, Number(comment.depth) || 0)),
      publishedLabel: typeof comment.publishedLabel === 'string' ? comment.publishedLabel.slice(0, 120) : undefined,
      media: compactMedia(comment.media || [])
    }];
  });
}

function payloadPost(post: NormalizedPost) {
  const metadata = post.metadata && typeof post.metadata === 'object' ? post.metadata : {};
  return {
    externalPostId: post.externalPostId,
    originalUrl: post.originalUrl,
    authorName: post.authorName,
    text: compactText(post.text || ''),
    media: compactMedia(post.media || []),
    comments: compactComments(post.comments),
    commentsTruncated: post.commentsTruncated === true,
    videoPresent: post.videoPresent === true,
    publishedAt: post.publishedAt,
    metadata: {
      collector: typeof metadata.collector === 'string' ? metadata.collector : undefined,
      feedIndex: typeof metadata.feedIndex === 'number' ? metadata.feedIndex : undefined,
      pinned: typeof metadata.pinned === 'boolean' ? metadata.pinned : undefined
    }
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_EXPLORE_RESPONSE_BYTES) throw new Error('Explore response exceeded the 4 MB safety limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EXPLORE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Explore response exceeded the 4 MB safety limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

async function sendExplore(
  authToken: string,
  batches: ExploreSourceBatch[],
  mode: ExploreMode,
  prompt: string,
  categories: string[],
  locale: 'ar' | 'en'
): Promise<any> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), EXPLORE_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl('/api/device/explore'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-MR-SCRAP-CLIENT': 'android-device-session',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        sources: batches.slice(0, 10).map(batch => ({ sourceId: batch.sourceId, posts: batch.posts.slice(0, 100).map(payloadPost) })),
        mode,
        prompt: prompt.slice(0, 5000),
        categories: categories.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().slice(0, 80)).slice(0, 12),
        locale
      }),
      signal: controller.signal
    });
    const raw = await readBoundedResponse(response);
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (!response.ok) {
      const error: any = new Error(body?.error || `Explore request failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Explore request timed out');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function apiExploreDevicePosts(
  batches: ExploreSourceBatch[],
  options: { mode: ExploreMode; prompt?: string; categories?: string[]; locale: 'ar' | 'en' }
): Promise<ExploreResponse> {
  let auth = await ensureApiDeviceAuth();
  let data: any;
  try {
    data = await sendExplore(auth.token, batches, options.mode, options.prompt || '', options.categories || [], options.locale);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      auth = await ensureApiDeviceAuth(true);
      data = await sendExplore(auth.token, batches, options.mode, options.prompt || '', options.categories || [], options.locale);
    } else {
      throw error;
    }
  }

  const items: ExploreResultItem[] = [];
  for (const raw of Array.isArray(data?.items) ? data.items : []) {
    try {
      const post = normalizePost(raw.post);
      const sourceAvatar = safeHttpsUrl(raw.sourceAvatar);
      items.push({
        post,
        sourceName: typeof raw.sourceName === 'string' ? raw.sourceName.trim().slice(0, 255) : '',
        sourceAvatar,
        relevant: raw.relevant === true,
        category: typeof raw.category === 'string' ? raw.category.trim().slice(0, 100) : '',
        confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
        reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 1000) : ''
      });
    } catch {
      if (import.meta.env.DEV) console.warn('[apiExploreDevicePosts] Ignoring malformed item');
    }
  }
  return {
    accepted: Math.max(0, Number(data?.accepted || 0) || 0),
    duplicates: Math.max(0, Number(data?.duplicates || 0) || 0),
    rejected: Math.max(0, Number(data?.rejected || 0) || 0),
    postsAnalyzed: Math.max(0, Number(data?.postsAnalyzed || 0) || 0),
    items
  };
}
