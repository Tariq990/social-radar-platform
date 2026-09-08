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

function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  if (!base) throw new Error('Android build is missing the backend origin.');
  return `${base}${path}`;
}

function normalizePlatform(value: unknown): SourcePlatform {
  return value === 'instagram' ? 'instagram' : value === 'facebook' ? 'facebook' : 'other';
}

function normalizePost(raw: any): NormalizedPost {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.canonical_url !== 'string') {
    throw new Error('Explore response contained a malformed post');
  }
  const platform = normalizePlatform(raw.platform);
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const comments = Array.isArray(metadata.exploreComments)
    ? metadata.exploreComments.flatMap((entry: any) => {
        if (!entry || typeof entry.authorName !== 'string' || typeof entry.text !== 'string') return [];
        return [{
          authorName: entry.authorName,
          text: entry.text,
          isPublisher: entry.isPublisher === true,
          depth: Math.max(0, Math.min(4, Number(entry.depth) || 0)),
          publishedLabel: typeof entry.publishedLabel === 'string' ? entry.publishedLabel : undefined,
          media: []
        }];
      }).slice(0, 200)
    : [];
  return {
    id: raw.id,
    sourceId: raw.source_id || '',
    platform,
    externalPostId: raw.external_id || undefined,
    originalUrl: raw.canonical_url,
    authorName: raw.author_name || '',
    authorAvatar: raw.author_avatar || undefined,
    text: typeof raw.text === 'string' ? raw.text : '',
    media: Array.isArray(raw.media)
      ? raw.media.filter((item: any) => item && (item.type === 'image' || item.type === 'video') && typeof item.url === 'string')
      : [],
    comments,
    commentsTruncated: metadata.commentsTruncated === true,
    videoPresent: metadata.videoPresent === true,
    publishedAt: raw.published_at || '',
    detectedAt: raw.created_at || '',
    fingerprint: raw.fingerprint || raw.external_id || raw.canonical_url,
    metadata
  };
}

/**
 * One Smart Grab can contain 100 posts and Express intentionally keeps a 1 MB JSON limit.
 * Preserve both ends of long posts (offers/CTAs are often near the end) while keeping even
 * Arabic-heavy UTF-8 payloads comfortably below that ceiling.
 */
function compactText(value: string): string {
  const text = value || '';
  if (text.length <= 1700) return text;
  return `${text.slice(0, 1200)}\n[…]\n${text.slice(-450)}`;
}

function compactMedia(media: NormalizedPost['media']): NormalizedPost['media'] {
  if (!Array.isArray(media)) return [];
  for (const item of media) {
    if (!item || (item.type !== 'image' && item.type !== 'video') || typeof item.url !== 'string') continue;
    // Extremely long signed CDN URLs are not useful enough to risk overflowing the request.
    if (!/^https?:\/\//i.test(item.url) || item.url.length > 1000) continue;
    return [{ type: item.type, url: item.url }];
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
    // Backend already knows the source avatar, so do not repeat the same long CDN URL 100 times.
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

async function sendExplore(
  authToken: string,
  batches: ExploreSourceBatch[],
  mode: ExploreMode,
  prompt: string,
  categories: string[],
  locale: 'ar' | 'en'
): Promise<any> {
  const response = await fetch(apiUrl('/api/device/explore'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-MR-SCRAP-CLIENT': 'android-device-session',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      sources: batches.map(batch => ({ sourceId: batch.sourceId, posts: batch.posts.map(payloadPost) })),
      mode,
      prompt,
      categories,
      locale
    })
  });
  const raw = await response.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!response.ok) {
    const error: any = new Error(body?.error || `Explore request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
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
      items.push({
        post: normalizePost(raw.post),
        sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : '',
        sourceAvatar: typeof raw.sourceAvatar === 'string' ? raw.sourceAvatar : undefined,
        relevant: Boolean(raw.relevant),
        category: typeof raw.category === 'string' ? raw.category : '',
        confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
        reason: typeof raw.reason === 'string' ? raw.reason : ''
      });
    } catch (error) {
      console.warn('[apiExploreDevicePosts] Ignoring malformed item', error);
    }
  }
  return {
    accepted: Number(data?.accepted || 0),
    duplicates: Number(data?.duplicates || 0),
    rejected: Number(data?.rejected || 0),
    postsAnalyzed: Number(data?.postsAnalyzed || 0),
    items
  };
}
