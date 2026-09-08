import { aiService } from '../ai/aiService';
import { ExploreAnalysisOptions } from '../ai/types';
import { db, DbPost } from '../db/database';
import { canonicalizeSocialUrl, computePostFingerprint } from './deduplication';
import type { DeviceNormalizedPostInput } from './deviceIngestion';

export interface DeviceExploreCommentInput {
  authorName?: string;
  text?: string;
  isPublisher?: boolean;
  depth?: number;
  publishedLabel?: string;
}

export interface DeviceExplorePostInput extends DeviceNormalizedPostInput {
  comments?: DeviceExploreCommentInput[];
  commentsTruncated?: boolean;
  videoPresent?: boolean;
}

export interface DeviceExploreSourceInput {
  sourceId: string;
  posts: DeviceExplorePostInput[];
}

export interface DeviceExploreItem {
  post: DbPost;
  sourceName: string;
  sourceAvatar?: string;
  relevant: boolean;
  category: string;
  confidence: number;
  reason: string;
}

export interface DeviceExploreResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  postsAnalyzed: number;
  items: DeviceExploreItem[];
}

function safeHttpUrl(value: unknown, maxLength: number = 4096): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.toString().slice(0, maxLength);
  } catch {
    return undefined;
  }
}

function sanitizeMedia(value: unknown): { type: 'image' | 'video'; url: string }[] {
  if (!Array.isArray(value)) return [];
  const result: { type: 'image' | 'video'; url: string }[] = [];
  for (const item of value.slice(0, 10)) {
    if (!item || (item.type !== 'image' && item.type !== 'video')) continue;
    const url = safeHttpUrl(item.url);
    if (url) result.push({ type: item.type, url });
  }
  return result;
}

function sanitizeExploreComments(value: unknown): { authorName: string; text: string; isPublisher: boolean; depth: number; publishedLabel?: string }[] {
  if (!Array.isArray(value)) return [];
  const output: { authorName: string; text: string; isPublisher: boolean; depth: number; publishedLabel?: string }[] = [];
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const authorName = typeof raw.authorName === 'string' ? raw.authorName.trim().slice(0, 160) : '';
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 700) : '';
    if (!authorName || !text) continue;
    output.push({
      authorName,
      text,
      isPublisher: raw.isPublisher === true,
      depth: Math.max(0, Math.min(4, Number(raw.depth) || 0)),
      publishedLabel: typeof raw.publishedLabel === 'string' ? raw.publishedLabel.trim().slice(0, 120) : undefined
    });
  }
  return output;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const blocked = ['cookie', 'cookies', 'password', 'passwd', 'session', 'sessionid', 'xs', 'c_user', 'token', 'access_token'];
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (blocked.some(blockedKey => key.toLowerCase().includes(blockedKey))) continue;
    if (typeof entry === 'string') result[key] = entry.slice(0, 500);
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) result[key] = entry;
  }
  return result;
}

function sanitizePublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || millis > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return new Date(millis).toISOString();
}

function allowedPostUrl(raw: string, platform: 'facebook' | 'instagram'): boolean {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return platform === 'instagram'
      ? host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')
      : host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
  } catch {
    return false;
  }
}

/**
 * Stores a user-requested authenticated snapshot without evaluating watch rules or creating
 * notifications. The returned analysis view uses the freshly collected DOM data even when the
 * same post was already persisted previously.
 */
export async function exploreDeviceSnapshots(
  batches: DeviceExploreSourceInput[],
  userId: string,
  options: ExploreAnalysisOptions
): Promise<DeviceExploreResult> {
  if (!Array.isArray(batches) || batches.length === 0 || batches.length > 10) throw new Error('Choose between 1 and 10 sources');

  const ownedSources = await db.getSources(userId);
  const sourceById = new Map(ownedSources.map(source => [source.id, source]));
  const analysisPosts: DbPost[] = [];
  const sourceInfo = new Map<string, { name: string; avatar?: string }>();
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  let totalInput = 0;

  for (const batch of batches) {
    const source = sourceById.get(batch?.sourceId);
    if (!source) throw new Error('Source not found');
    if (source.connector_type !== 'device_session') throw new Error('Explore requires an authenticated device-session source');
    if (!Array.isArray(batch.posts)) throw new Error('posts must be an array');
    totalInput += batch.posts.length;
    if (totalInput > 100) throw new Error('Explore accepts at most 100 posts per request');

    sourceInfo.set(source.id, { name: source.name, avatar: source.avatar_url });
    for (const raw of batch.posts.slice(0, 20)) {
      const originalUrl = typeof raw.originalUrl === 'string' ? raw.originalUrl.trim() : '';
      if (!originalUrl || !allowedPostUrl(originalUrl, source.platform)) {
        rejected++;
        continue;
      }
      const canonicalUrl = canonicalizeSocialUrl(originalUrl);
      const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 10_000) : '';
      if (!text) {
        rejected++;
        continue;
      }
      const externalId = typeof raw.externalPostId === 'string' && raw.externalPostId.trim()
        ? raw.externalPostId.trim().slice(0, 512)
        : undefined;
      const fingerprint = `${source.id}:${computePostFingerprint(source.platform, externalId, canonicalUrl, text)}`.slice(0, 255);
      const metadata = { ...sanitizeMetadata(raw.metadata), ingestion: 'android_device_explore' };
      const exploreComments = sanitizeExploreComments(raw.comments);
      const analysisMetadata = {
        ...metadata,
        exploreComments,
        commentsTruncated: raw.commentsTruncated === true,
        videoPresent: raw.videoPresent === true
      };
      const authorName = typeof raw.authorName === 'string' && raw.authorName.trim() ? raw.authorName.trim().slice(0, 255) : source.name;
      const authorAvatar = safeHttpUrl(raw.authorAvatar) || source.avatar_url;
      const media = sanitizeMedia(raw.media);
      const publishedAt = sanitizePublishedAt(raw.publishedAt);
      const candidateId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const persisted = await db.createPost({
        id: candidateId,
        source_id: source.id,
        platform: source.platform,
        external_id: externalId,
        canonical_url: canonicalUrl,
        author_name: authorName,
        author_avatar: authorAvatar,
        text,
        media,
        published_at: publishedAt,
        fingerprint,
        metadata
      });
      if (persisted.id === candidateId) accepted++; else duplicates++;

      analysisPosts.push({
        ...persisted,
        canonical_url: canonicalUrl,
        author_name: authorName,
        author_avatar: authorAvatar,
        text,
        media,
        published_at: publishedAt || persisted.published_at,
        metadata: { ...(persisted.metadata || {}), ...analysisMetadata }
      });
    }
  }

  // A dynamic feed can expose the same link in more than one DOM container. Classify each real
  // persisted post only once even if the raw collection contained a duplicate representation.
  const uniquePosts = [...new Map(analysisPosts.map(post => [post.id, post])).values()];
  if (uniquePosts.length === 0) return { accepted, duplicates, rejected, postsAnalyzed: 0, items: [] };

  const analysis = await aiService.analyzePosts(uniquePosts, options);
  const analysisById = new Map(analysis.map(item => [item.postId, item]));
  const items: DeviceExploreItem[] = [];
  for (const post of uniquePosts) {
    const result = analysisById.get(post.id);
    if (!result) continue;
    const source = sourceInfo.get(post.source_id);
    items.push({
      post,
      sourceName: source?.name || post.author_name || '',
      sourceAvatar: source?.avatar,
      relevant: result.relevant,
      category: result.category,
      confidence: result.confidence,
      reason: result.reason
    });
  }

  for (const sourceId of new Set(batches.map(batch => batch.sourceId))) {
    await db.updateSourceHealth(sourceId, 'connected', true).catch(() => {});
    await db.logConnectorEvent(sourceId, 'device_explore', 'success', 'Analyzed an on-demand snapshot without creating watch alerts.').catch(() => {});
  }

  return { accepted, duplicates, rejected, postsAnalyzed: uniquePosts.length, items };
}
