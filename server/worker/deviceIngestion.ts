import { db, DbMatch, DbPost, DbRule, DbSource } from '../db/database';
import { canonicalizeSocialUrl, computePostFingerprint } from './deduplication';
import { evaluatePostAgainstRule, isLatestPostIntent } from '../ai/ruleEvaluator';
import { notificationService } from '../notifications';

export interface DeviceNormalizedPostInput {
  externalPostId?: string;
  originalUrl: string;
  authorName?: string;
  authorAvatar?: string;
  text?: string;
  media?: { type: 'image' | 'video'; url: string }[];
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceIngestionResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  matchesCreated: DbMatch[];
  evaluationErrors: { postId: string; ruleId: string; error: string }[];
  sourceMetadata?: {
    displayName: string;
    avatarUrl?: string;
    handle?: string;
  };
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
  for (const item of value.slice(0, 20)) {
    if (!item || (item.type !== 'image' && item.type !== 'video')) continue;
    const url = safeHttpUrl(item.url);
    if (url) result.push({ type: item.type, url });
  }
  return result;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const blocked = ['cookie', 'cookies', 'password', 'passwd', 'session', 'sessionid', 'xs', 'c_user', 'token', 'access_token'];
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(input)) {
    if (blocked.some(blockedKey => key.toLowerCase().includes(blockedKey))) continue;
    if (typeof entry === 'string') result[key] = entry.slice(0, 2000);
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) result[key] = entry;
  }
  return result;
}

function sanitizePublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return undefined;
  if (millis > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return new Date(millis).toISOString();
}

function isAllowedPostUrl(raw: string, platform: 'facebook' | 'instagram'): boolean {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (platform === 'instagram') {
      return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
    }
    return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
  } catch {
    return false;
  }
}

function normalizeIdentity(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/^@/, '').toLowerCase()
    : '';
}

function isGenericSourceName(value: unknown, source: DbSource): boolean {
  const name = normalizeIdentity(value);
  if (!name) return true;
  const generic = new Set([
    'facebook', 'instagram', 'page', 'profile', 'home', 'log into facebook', 'log in to facebook',
    normalizeIdentity(source.external_id), normalizeIdentity(source.handle)
  ].filter(Boolean));
  return generic.has(name);
}

async function healSourceMetadataFromPosts(
  source: DbSource,
  posts: DeviceNormalizedPostInput[]
): Promise<DbSource> {
  let betterName = '';
  let betterAvatar = '';

  for (const post of posts.slice(0, 20)) {
    if (!betterName && isGenericSourceName(source.name, source)) {
      const candidate = typeof post?.authorName === 'string' ? post.authorName.trim().slice(0, 255) : '';
      if (candidate && !isGenericSourceName(candidate, source)) betterName = candidate;
    }
    if (!betterAvatar && !source.avatar_url) betterAvatar = safeHttpUrl(post?.authorAvatar) || '';
    if ((betterName || !isGenericSourceName(source.name, source)) && (betterAvatar || source.avatar_url)) break;
  }

  if (!betterName && !betterAvatar) return source;
  const updated = await db.updateSourceMetadata(source.id, {
    name: betterName || undefined,
    avatar_url: betterAvatar || undefined
  });
  return updated || source;
}

function latestCandidateInputIndex(posts: DeviceNormalizedPostInput[], platform: 'facebook' | 'instagram'): number {
  let winner = -1;
  let winnerRank = Number.POSITIVE_INFINITY;
  for (let index = 0; index < Math.min(posts.length, 50); index++) {
    const raw = posts[index];
    const originalUrl = typeof raw?.originalUrl === 'string' ? raw.originalUrl.trim() : '';
    if (!originalUrl || !isAllowedPostUrl(originalUrl, platform)) continue;
    const metadata = raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? raw.metadata as Record<string, unknown>
      : {};
    if (metadata.pinned === true) continue;
    const feedIndex = Number(metadata.feedIndex);
    const rank = Number.isFinite(feedIndex) && feedIndex >= 0 ? feedIndex : 10_000 + index;
    if (rank < winnerRank) {
      winner = index;
      winnerRank = rank;
    }
  }
  return winner;
}

async function evaluateAndPersistMatches(
  post: DbPost,
  rules: DbRule[],
  source: DbSource,
  userId: string,
  locale: 'en' | 'ar',
  knownMatchKeys: Set<string>,
  result: DeviceIngestionResult
): Promise<void> {
  for (const rule of rules) {
    const matchKey = `${rule.id}:${post.id}`;
    if (knownMatchKeys.has(matchKey)) continue;

    try {
      const evaluation = await evaluatePostAgainstRule(post, rule, locale);
      if (!evaluation.matched) continue;

      const candidateMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const match = await db.createMatch({
        id: candidateMatchId,
        user_id: userId,
        post_id: post.id,
        rule_id: rule.id,
        source_id: source.id,
        confidence: evaluation.confidence,
        category: evaluation.category,
        reason: evaluation.reason,
        extracted: evaluation.extracted,
        feedback: 'unrated',
        is_read: false,
        is_saved: false
      });

      if (match.id !== candidateMatchId) {
        knownMatchKeys.add(matchKey);
        continue;
      }

      knownMatchKeys.add(matchKey);
      match.source_name = source.name;
      match.source_avatar = source.avatar_url;
      match.source_platform = source.platform;
      match.rule_name = rule.name;
      match.post = post;
      result.matchesCreated.push(match);

      await notificationService.dispatchMatchNotification(match);
    } catch (error: any) {
      result.evaluationErrors.push({
        postId: post.id,
        ruleId: rule.id,
        error: error?.message || 'AI evaluation failed'
      });
    }
  }
}

/**
 * Accepts already-normalized content from the user's authenticated Android collector.
 * Raw browser cookies/session material are not part of this contract and are discarded if
 * a caller accidentally places secret-looking values in metadata.
 */
export async function ingestDevicePosts(
  sourceId: string,
  posts: DeviceNormalizedPostInput[],
  userId: string = 'user_default',
  locale: 'en' | 'ar' = 'en'
): Promise<DeviceIngestionResult> {
  const result: DeviceIngestionResult = {
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    matchesCreated: [],
    evaluationErrors: []
  };

  const sources = await db.getSources(userId);
  let source = sources.find(item => item.id === sourceId);
  if (!source) throw new Error('Source not found');
  if (source.is_paused) throw new Error('Source is paused');
  if (source.connector_type !== 'device_session') {
    throw new Error('Source is not configured for authenticated device monitoring');
  }

  const incoming = posts.slice(0, 50);
  // Source onboarding can deliberately move ahead after a short resolver budget so the user is
  // never stuck behind Meta's lazy DOM. The first successful authenticated collection therefore
  // doubles as a trusted metadata repair pass for placeholder @handles and missing avatars.
  source = await healSourceMetadataFromPosts(source, incoming);
  result.sourceMetadata = {
    displayName: source.name,
    avatarUrl: source.avatar_url,
    handle: source.handle
  };

  const allRules = await db.getRules(userId);
  const sourceRules = allRules.filter(rule =>
    rule.enabled && (!rule.source_ids || rule.source_ids.length === 0 || rule.source_ids.includes(source.id))
  );
  const latestPostRules = sourceRules.filter(rule => isLatestPostIntent(rule.natural_language || ''));
  const knownMatchKeys = new Set(
    (await db.getMatches(userId)).map(match => `${match.rule_id}:${match.post_id}`)
  );
  const latestCandidateIndex = latestCandidateInputIndex(incoming, source.platform);
  const isInitialBaseline = !source.last_checked_at;

  for (const [rawIndex, raw] of incoming.entries()) {
    const originalUrl = typeof raw.originalUrl === 'string' ? raw.originalUrl.trim() : '';
    if (!originalUrl || !isAllowedPostUrl(originalUrl, source.platform)) {
      result.rejected++;
      continue;
    }

    const canonicalUrl = canonicalizeSocialUrl(originalUrl);
    const text = typeof raw.text === 'string' ? raw.text.slice(0, 100_000) : '';
    const externalId = typeof raw.externalPostId === 'string' && raw.externalPostId.trim()
      ? raw.externalPostId.trim().slice(0, 512)
      : undefined;
    const contentFingerprint = computePostFingerprint(source.platform, externalId, canonicalUrl, text);
    const fingerprint = `${source.id}:${contentFingerprint}`.slice(0, 255);
    const currentMetadata = {
      ...sanitizeMetadata(raw.metadata),
      latestCandidate: rawIndex === latestCandidateIndex,
      ingestion: 'android_device_session'
    };

    const candidatePostId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const savedPost = await db.createPost({
      id: candidatePostId,
      source_id: source.id,
      platform: source.platform,
      external_id: externalId,
      canonical_url: canonicalUrl,
      author_name: typeof raw.authorName === 'string' ? raw.authorName.slice(0, 255) : source.name,
      author_avatar: safeHttpUrl(raw.authorAvatar) || source.avatar_url,
      text,
      media: sanitizeMedia(raw.media),
      published_at: sanitizePublishedAt(raw.publishedAt),
      fingerprint,
      metadata: currentMetadata
    });

    const isDuplicate = savedPost.id !== candidatePostId;
    if (isDuplicate) {
      result.duplicates++;
      if (latestPostRules.length > 0) {
        const currentViewPost: DbPost = {
          ...savedPost,
          metadata: {
            ...(savedPost.metadata || {}),
            ...currentMetadata
          }
        };
        await evaluateAndPersistMatches(
          currentViewPost,
          latestPostRules,
          source,
          userId,
          locale,
          knownMatchKeys,
          result
        );
      }
      continue;
    }

    result.accepted++;
    await evaluateAndPersistMatches(
      savedPost,
      isInitialBaseline ? latestPostRules : sourceRules,
      source,
      userId,
      locale,
      knownMatchKeys,
      result
    );
  }

  await db.updateSourceHealth(source.id, 'connected', true);
  await db.logConnectorEvent(
    source.id,
    'device_ingest',
    'success',
    `Accepted ${result.accepted} new posts; ignored ${result.duplicates} duplicates; rejected ${result.rejected} invalid records.${isInitialBaseline ? ' Initial snapshot was stored as a baseline.' : ''}`
  );

  return result;
}
