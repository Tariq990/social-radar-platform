import { db, DbMatch, DbPost, DbRule, DbSource } from '../db/database';
import { sourceConnectorManager } from '../connectors/sourceConnector';
import { computePostFingerprint, canonicalizeSocialUrl } from './deduplication';
import { evaluatePostAgainstRule, isLatestPostIntent } from '../ai/ruleEvaluator';
import { notificationService } from '../notifications';
import type { RawProviderPost } from '../connectors/types';

export interface MonitoringJobResult {
  sourcesScanned: number;
  deviceManagedSources: number;
  newPostsFound: number;
  matchesCreated: DbMatch[];
  errors: { sourceId: string; error: string }[];
  timestamp: string;
}

function sanitizePublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || millis > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return new Date(millis).toISOString();
}

function safeHttpsUrl(value: unknown, maxLength: number = 4096): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString().slice(0, maxLength);
  } catch {
    return undefined;
  }
}

function allowedSocialUrl(value: unknown, platform: 'facebook' | 'instagram'): string | undefined {
  const normalized = safeHttpsUrl(value);
  if (!normalized) return undefined;
  const host = new URL(normalized).hostname.toLowerCase();
  const allowed = platform === 'instagram'
    ? host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')
    : host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
  return allowed ? canonicalizeSocialUrl(normalized) : undefined;
}

function sanitizeMedia(value: unknown): { type: 'image' | 'video'; url: string }[] {
  if (!Array.isArray(value)) return [];
  const output: { type: 'image' | 'video'; url: string }[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 20)) {
    if (!item || (item.type !== 'image' && item.type !== 'video')) continue;
    const url = safeHttpsUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ type: item.type, url });
  }
  return output;
}

function sanitizeProviderMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const blocked = ['cookie', 'cookies', 'password', 'passwd', 'session', 'sessionid', 'token', 'access_token', 'authorization'];
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (blocked.some(blockedKey => key.toLowerCase().includes(blockedKey))) continue;
    if (typeof entry === 'string') output[key] = entry.slice(0, 1000);
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) output[key] = entry;
  }
  return output;
}

function latestProviderCandidateIndex(posts: RawProviderPost[], platform: 'facebook' | 'instagram'): number {
  let fallback = -1;
  let newest = -1;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];
    if (!allowedSocialUrl(post?.url, platform)) continue;
    if (fallback < 0) fallback = index;
    const published = typeof post?.publishedAt === 'string' ? Date.parse(post.publishedAt) : NaN;
    if (Number.isFinite(published) && published > newestTime) {
      newest = index;
      newestTime = published;
    }
  }
  return newest >= 0 ? newest : fallback;
}

async function evaluateAndPersistRules(
  post: DbPost,
  rules: DbRule[],
  source: DbSource,
  userId: string,
  result: MonitoringJobResult
): Promise<void> {
  for (const rule of rules) {
    try {
      const evalResult = await evaluatePostAgainstRule(post, rule, 'en');
      if (!evalResult.matched) continue;

      const candidateMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdMatch = await db.createMatch({
        id: candidateMatchId,
        user_id: userId,
        post_id: post.id,
        rule_id: rule.id,
        source_id: source.id,
        confidence: evalResult.confidence,
        category: evalResult.category,
        reason: evalResult.reason,
        extracted: evalResult.extracted,
        feedback: 'unrated',
        is_read: false,
        is_saved: false
      });

      if (createdMatch.id !== candidateMatchId) continue;

      createdMatch.source_name = source.name;
      createdMatch.source_avatar = safeHttpsUrl(source.avatar_url);
      createdMatch.source_platform = source.platform;
      createdMatch.rule_name = rule.name;
      createdMatch.post = post;
      result.matchesCreated.push(createdMatch);

      if (rule.alert_mode !== 'silent') {
        try {
          await notificationService.dispatchMatchNotification(createdMatch);
        } catch {
          await db.logConnectorEvent(source.id, 'notification', 'error', 'Match persisted but in-app notification persistence failed.').catch(() => {});
        }
      }
    } catch (evalError: any) {
      const message = String(evalError?.message || 'AI evaluation failed').slice(0, 500);
      await db.logConnectorEvent(source.id, 'ai_evaluation', 'error', `Rule ${rule.id}: ${message}`);
    }
  }
}

/**
 * Server-side monitoring worker.
 * Authenticated device_session sources remain on-device and enter through /api/device/ingest.
 * The first server-managed snapshot is stored as a baseline so historical provider content cannot
 * manufacture alerts; only an explicit latest/new-post rule may match the single newest candidate.
 */
export class MonitoringWorker {
  private readonly runningUsers = new Set<string>();

  async runScan(userId: string = 'user_default', isDemoMode: boolean = false): Promise<MonitoringJobResult> {
    if (this.runningUsers.has(userId)) {
      return {
        sourcesScanned: 0,
        deviceManagedSources: 0,
        newPostsFound: 0,
        matchesCreated: [],
        errors: [{ sourceId: 'system', error: 'Scan already in progress' }],
        timestamp: new Date().toISOString()
      };
    }

    this.runningUsers.add(userId);
    const result: MonitoringJobResult = {
      sourcesScanned: 0,
      deviceManagedSources: 0,
      newPostsFound: 0,
      matchesCreated: [],
      errors: [],
      timestamp: new Date().toISOString()
    };

    try {
      const allSources = await db.getSources(userId);
      const activeSources = allSources.filter(source => !source.is_paused);
      if (activeSources.length === 0) return result;

      const allRules = await db.getRules(userId);
      const activeRules = allRules.filter(rule => rule.enabled);

      for (const source of activeSources) {
        if (!isDemoMode && source.connector_type === 'device_session') {
          result.deviceManagedSources++;
          await db.logConnectorEvent(
            source.id,
            'fetch',
            'warning',
            'Device-managed source: waiting for normalized post ingestion from connected Android device.'
          );
          continue;
        }

        result.sourcesScanned++;
        try {
          const sourceRules = activeRules.filter(rule =>
            !rule.source_ids || rule.source_ids.length === 0 || rule.source_ids.includes(source.id)
          );
          const latestPostRules = sourceRules.filter(rule => isLatestPostIntent(rule.natural_language || ''));
          const isInitialBaseline = !source.last_checked_at;

          const rawPosts = await sourceConnectorManager.fetchLatest({
            id: source.id,
            url: source.url,
            platform: source.platform,
            externalId: source.external_id,
            connectorType: source.connector_type
          }, isDemoMode);
          const latestCandidateIndex = latestProviderCandidateIndex(rawPosts, source.platform);

          for (const [rawIndex, raw] of rawPosts.entries()) {
            const canonicalUrl = allowedSocialUrl(raw.url || source.url, source.platform);
            if (!canonicalUrl) {
              result.errors.push({ sourceId: source.id, error: 'Provider returned an invalid post URL' });
              continue;
            }
            const text = typeof raw.text === 'string' ? raw.text.slice(0, 100_000) : '';
            const externalId = typeof raw.externalId === 'string' && raw.externalId.trim()
              ? raw.externalId.trim().slice(0, 512)
              : undefined;
            const contentFingerprint = computePostFingerprint(source.platform, externalId, canonicalUrl, text);
            const fingerprint = `${source.id}:${contentFingerprint}`.slice(0, 255);
            const currentMetadata = {
              ...sanitizeProviderMetadata(raw.metadata),
              feedIndex: rawIndex,
              latestCandidate: rawIndex === latestCandidateIndex,
              ingestion: 'server_public_provider'
            };

            const candidatePostId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const savedPost = await db.createPost({
              id: candidatePostId,
              source_id: source.id,
              platform: source.platform,
              external_id: externalId,
              canonical_url: canonicalUrl,
              author_name: typeof raw.authorName === 'string' && raw.authorName.trim() ? raw.authorName.trim().slice(0, 255) : source.name,
              author_avatar: safeHttpsUrl(raw.authorAvatar) || safeHttpsUrl(source.avatar_url),
              text,
              media: sanitizeMedia(raw.media),
              published_at: sanitizePublishedAt(raw.publishedAt),
              fingerprint,
              metadata: currentMetadata
            });

            if (savedPost.id !== candidatePostId) {
              if (latestPostRules.length > 0) {
                const currentViewPost: DbPost = {
                  ...savedPost,
                  metadata: {
                    ...(savedPost.metadata || {}),
                    ...currentMetadata
                  }
                };
                await evaluateAndPersistRules(currentViewPost, latestPostRules, source, userId, result);
              }
              continue;
            }

            result.newPostsFound++;
            await evaluateAndPersistRules(
              savedPost,
              isInitialBaseline ? latestPostRules : sourceRules,
              source,
              userId,
              result
            );
          }

          await db.updateSourceHealth(source.id, 'connected', true);
          await db.logConnectorEvent(
            source.id,
            'fetch',
            'success',
            `Fetched ${rawPosts.length} posts from server-side provider${isInitialBaseline ? '; initial snapshot stored as baseline' : ''}`
          );
        } catch (sourceError: any) {
          const message = String(sourceError?.message || 'Unknown source fetch error').slice(0, 500);
          result.errors.push({ sourceId: source.id, error: message });
          const status = (source.consecutive_failures || 0) >= 2 ? 'needs_attention' : 'error';
          await db.updateSourceHealth(source.id, status, false, message);
          await db.logConnectorEvent(source.id, 'fetch', 'error', message);
        }
      }
    } finally {
      this.runningUsers.delete(userId);
    }

    return result;
  }
}

export const monitoringWorker = new MonitoringWorker();
