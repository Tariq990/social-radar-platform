import { db, DbSource, DbRule, DbPost, DbMatch } from '../db/database';
import { sourceConnectorManager } from '../connectors/sourceConnector';
import { computePostFingerprint, canonicalizeSocialUrl } from './deduplication';
import { evaluatePostAgainstRule } from '../ai/ruleEvaluator';
import { notificationService } from '../notifications';

export interface MonitoringJobResult {
  sourcesScanned: number;
  newPostsFound: number;
  matchesCreated: DbMatch[];
  errors: { sourceId: string; error: string }[];
  timestamp: string;
}

/**
 * Backend Monitoring Worker
 * Idempotent, deterministic pipeline that fetches real live posts, deduplicates them,
 * evaluates newly seen posts against active rules with Gemini, and records real matches.
 */
export class MonitoringWorker {
  private isRunning = false;

  async runScan(userId: string = 'user_default', isDemoMode: boolean = false): Promise<MonitoringJobResult> {
    if (this.isRunning) {
      console.log('[MonitoringWorker] Scan already in progress, skipping concurrent run.');
      return {
        sourcesScanned: 0,
        newPostsFound: 0,
        matchesCreated: [],
        errors: [{ sourceId: 'system', error: 'Scan already in progress' }],
        timestamp: new Date().toISOString()
      };
    }

    this.isRunning = true;
    const result: MonitoringJobResult = {
      sourcesScanned: 0,
      newPostsFound: 0,
      matchesCreated: [],
      errors: [],
      timestamp: new Date().toISOString()
    };

    try {
      // 1. Load active, non-paused sources
      const allSources = await db.getSources(userId);
      const activeSources = allSources.filter(s => !s.is_paused);
      result.sourcesScanned = activeSources.length;

      if (activeSources.length === 0) {
        return result;
      }

      // 2. Load all active rules for this user
      const allRules = await db.getRules(userId);
      const activeRules = allRules.filter(r => r.enabled);

      // Process each source
      for (const source of activeSources) {
        try {
          // Find rules subscribed to this specific source
          const sourceRules = activeRules.filter(r => 
            !r.source_ids || r.source_ids.length === 0 || r.source_ids.includes(source.id)
          );

          // Fetch real posts via connector
          const rawPosts = await sourceConnectorManager.fetchLatest({
            id: source.id,
            url: source.url,
            platform: source.platform,
            externalId: source.external_id
          }, isDemoMode);

          // Update source health on successful fetch
          await db.updateSourceHealth(source.id, 'connected', true);
          await db.logConnectorEvent(source.id, 'fetch', 'success', `Fetched ${rawPosts.length} posts from provider`);

          // Process and deduplicate each post
          for (const raw of rawPosts) {
            const canonicalUrl = canonicalizeSocialUrl(raw.url);
            const fingerprint = computePostFingerprint(
              source.platform,
              raw.externalId,
              canonicalUrl,
              raw.text
            );

            // Check if post has already been recorded
            const alreadySeen = await db.hasPostFingerprint(fingerprint);
            if (alreadySeen) {
              // Deduplication in effect: skip evaluation for already processed posts
              continue;
            }

            // Insert new post into DB
            const postId = `post_${source.platform}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const savedPost = await db.createPost({
              id: postId,
              source_id: source.id,
              platform: source.platform,
              external_id: raw.externalId,
              canonical_url: canonicalUrl,
              author_name: raw.authorName || source.name,
              author_avatar: raw.authorAvatar || source.avatar_url,
              text: raw.text,
              media: raw.media || [],
              published_at: raw.publishedAt || new Date().toISOString(),
              fingerprint,
              metadata: raw.metadata || {}
            });

            result.newPostsFound++;

            // Evaluate this new post against all active rules for this source
            for (const rule of sourceRules) {
              try {
                const evalResult = await evaluatePostAgainstRule(savedPost, rule, 'en');

                if (evalResult.matched) {
                  const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                  const createdMatch = await db.createMatch({
                    id: matchId,
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

                  // Attach post and source info for presentation
                  createdMatch.source_name = source.name;
                  createdMatch.source_avatar = source.avatar_url;
                  createdMatch.source_platform = source.platform;
                  createdMatch.rule_name = rule.name;
                  createdMatch.post = savedPost;

                  result.matchesCreated.push(createdMatch);

                  // Prepare and record notification
                  await notificationService.dispatchMatchNotification(createdMatch);
                }
              } catch (evalErr: any) {
                console.warn(`[MonitoringWorker] Rule evaluation error for rule ${rule.id}:`, evalErr?.message);
              }
            }
          }
        } catch (srcErr: any) {
          const errMsg = srcErr?.message || 'Unknown source fetch error';
          result.errors.push({ sourceId: source.id, error: errMsg });

          // Update source failure state
          const newStatus = (source.consecutive_failures || 0) >= 2 ? 'needs_attention' : 'error';
          await db.updateSourceHealth(source.id, newStatus, false, errMsg);
          await db.logConnectorEvent(source.id, 'fetch', 'error', errMsg);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return result;
  }
}

export const monitoringWorker = new MonitoringWorker();
