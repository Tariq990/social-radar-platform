import { db, DbMatch } from '../db/database';
import { canonicalizeSocialUrl, computePostFingerprint } from './deduplication';
import { evaluatePostAgainstRule } from '../ai/ruleEvaluator';
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
  matchesCreated: DbMatch[];
  evaluationErrors: { postId: string; ruleId: string; error: string }[];
}

function sanitizeMedia(value: unknown): { type: 'image' | 'video'; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.type === 'image' || item.type === 'video') && typeof item.url === 'string')
    .slice(0, 20)
    .map((item: any) => ({ type: item.type, url: item.url.slice(0, 4096) }));
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
    matchesCreated: [],
    evaluationErrors: []
  };

  const sources = await db.getSources(userId);
  const source = sources.find(item => item.id === sourceId);
  if (!source) throw new Error('Source not found');
  if (source.is_paused) throw new Error('Source is paused');
  if (source.connector_type !== 'device_session') {
    throw new Error('Source is not configured for authenticated device monitoring');
  }

  const allRules = await db.getRules(userId);
  const sourceRules = allRules.filter(rule =>
    rule.enabled && (!rule.source_ids || rule.source_ids.length === 0 || rule.source_ids.includes(source.id))
  );

  for (const raw of posts.slice(0, 50)) {
    const originalUrl = typeof raw.originalUrl === 'string' ? raw.originalUrl.trim() : '';
    if (!originalUrl || !isAllowedPostUrl(originalUrl, source.platform)) continue;

    const canonicalUrl = canonicalizeSocialUrl(originalUrl);
    const text = typeof raw.text === 'string' ? raw.text.slice(0, 100_000) : '';
    const externalId = typeof raw.externalPostId === 'string' ? raw.externalPostId.slice(0, 512) : undefined;
    const fingerprint = computePostFingerprint(source.platform, externalId, canonicalUrl, text);

    if (await db.hasPostFingerprint(fingerprint)) {
      result.duplicates++;
      continue;
    }

    const candidatePostId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const savedPost = await db.createPost({
      id: candidatePostId,
      source_id: source.id,
      platform: source.platform,
      external_id: externalId,
      canonical_url: canonicalUrl,
      author_name: typeof raw.authorName === 'string' ? raw.authorName.slice(0, 255) : source.name,
      author_avatar: typeof raw.authorAvatar === 'string' ? raw.authorAvatar.slice(0, 4096) : source.avatar_url,
      text,
      media: sanitizeMedia(raw.media),
      published_at: raw.publishedAt || new Date().toISOString(),
      fingerprint,
      metadata: {
        ...sanitizeMetadata(raw.metadata),
        ingestion: 'android_device_session'
      }
    });

    // A concurrent worker can win the fingerprint insert after our preflight check.
    // PostgreSQL createPost returns the already-persisted row in that case; never evaluate
    // or notify the same social post twice.
    if (savedPost.id !== candidatePostId) {
      result.duplicates++;
      continue;
    }

    result.accepted++;

    for (const rule of sourceRules) {
      try {
        const evaluation = await evaluatePostAgainstRule(savedPost, rule, locale);
        if (!evaluation.matched) continue;

        const candidateMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const match = await db.createMatch({
          id: candidateMatchId,
          user_id: userId,
          post_id: savedPost.id,
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

        // createMatch is idempotent on (rule_id, post_id). If another worker created the
        // match first, do not emit a second push/notification for the same rule and post.
        if (match.id !== candidateMatchId) continue;

        match.source_name = source.name;
        match.source_avatar = source.avatar_url;
        match.source_platform = source.platform;
        match.rule_name = rule.name;
        match.post = savedPost;
        result.matchesCreated.push(match);

        await notificationService.dispatchMatchNotification(match);
      } catch (error: any) {
        result.evaluationErrors.push({
          postId: savedPost.id,
          ruleId: rule.id,
          error: error?.message || 'AI evaluation failed'
        });
      }
    }
  }

  await db.updateSourceHealth(source.id, 'connected', true);
  await db.logConnectorEvent(
    source.id,
    'device_ingest',
    'success',
    `Accepted ${result.accepted} new posts; ignored ${result.duplicates} duplicates from authenticated Android device.`
  );

  return result;
}
