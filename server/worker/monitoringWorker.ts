import { db, DbMatch } from '../db/database';
import { sourceConnectorManager } from '../connectors/sourceConnector';
import { computePostFingerprint, canonicalizeSocialUrl } from './deduplication';
import { evaluatePostAgainstRule } from '../ai/ruleEvaluator';
import { notificationService } from '../notifications';

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

/**
 * Server-side monitoring worker.
 *
 * Server-side providers are optional. Authenticated device_session sources are intentionally
 * NOT fetched by this worker because their Facebook/Instagram session must remain on-device.
 * Those posts enter the same persistence/AI pipeline through /api/device/ingest.
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

        // Count a server-side source as scanned only when this worker actually attempts its fetch.
        // Device-managed sources are reported separately and are not double-counted by the client.
        result.sourcesScanned++;
        try {
          const sourceRules = activeRules.filter(rule =>
            !rule.source_ids || rule.source_ids.length === 0 || rule.source_ids.includes(source.id)
          );

          const rawPosts = await sourceConnectorManager.fetchLatest({
            id: source.id,
            url: source.url,
            platform: source.platform,
            externalId: source.external_id,
            connectorType: source.connector_type
          }, isDemoMode);

          await db.updateSourceHealth(source.id, 'connected', true);
          await db.logConnectorEvent(source.id, 'fetch', 'success', `Fetched ${rawPosts.length} posts from server-side provider`);

          for (const raw of rawPosts) {
            const canonicalUrl = canonicalizeSocialUrl(raw.url || source.url);
            const contentFingerprint = computePostFingerprint(
              source.platform,
              raw.externalId,
              canonicalUrl,
              raw.text
            );
            const fingerprint = `${source.id}:${contentFingerprint}`.slice(0, 255);

            if (await db.hasPostFingerprint(fingerprint)) continue;

            const candidatePostId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const savedPost = await db.createPost({
              id: candidatePostId,
              source_id: source.id,
              platform: source.platform,
              external_id: raw.externalId,
              canonical_url: canonicalUrl,
              author_name: raw.authorName || source.name,
              author_avatar: raw.authorAvatar || source.avatar_url,
              text: raw.text || '',
              media: raw.media || [],
              published_at: sanitizePublishedAt(raw.publishedAt),
              fingerprint,
              metadata: raw.metadata || {}
            });

            if (savedPost.id !== candidatePostId) continue;

            result.newPostsFound++;

            for (const rule of sourceRules) {
              try {
                const evalResult = await evaluatePostAgainstRule(savedPost, rule, 'en');
                if (!evalResult.matched) continue;

                const candidateMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const createdMatch = await db.createMatch({
                  id: candidateMatchId,
                  user_id: userId,
                  post_id: savedPost.id,
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
                createdMatch.source_avatar = source.avatar_url;
                createdMatch.source_platform = source.platform;
                createdMatch.rule_name = rule.name;
                createdMatch.post = savedPost;
                result.matchesCreated.push(createdMatch);

                await notificationService.dispatchMatchNotification(createdMatch);
              } catch (evalError: any) {
                const message = evalError?.message || 'AI evaluation failed';
                await db.logConnectorEvent(source.id, 'ai_evaluation', 'error', `Rule ${rule.id}: ${message}`);
              }
            }
          }
        } catch (sourceError: any) {
          const message = sourceError?.message || 'Unknown source fetch error';
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
