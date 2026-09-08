import express from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import { db } from './server/db/database';
import { sourceConnectorManager } from './server/connectors/sourceConnector';
import { monitoringWorker } from './server/worker/monitoringWorker';
import { ingestDevicePosts } from './server/worker/deviceIngestion';
import { evaluatePostAgainstRule } from './server/ai/ruleEvaluator';
import { aiService } from './server/ai/aiService';
import { getAIConfigurationStatus, testConfiguredAIProvider } from './server/ai/providerFactory';
import { strictCors } from './server/http/cors';
import { ensureCurrentBackendIdentity, registerDevice, requireDeviceAuth } from './server/auth/deviceAuth';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_MODE = (process.env.APP_MODE || 'production').trim().toLowerCase();
const isDemoMode = () => APP_MODE === 'demo';

app.disable('x-powered-by');
app.use(strictCors);
app.use(express.json({ limit: '1mb' }));

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(limit: number = 30, windowMs: number = 60_000) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + windowMs;
    }

    entry.count++;
    rateLimitMap.set(ip, entry);
    if (entry.count > limit) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    next();
  };
}

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap) {
    if (value.resetTime + 60_000 < now) rateLimitMap.delete(key);
  }
}, 5 * 60_000);
rateLimitCleanup.unref();

function safeError(error: any): string {
  return error?.message || 'Unexpected server error';
}

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireInternalAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (APP_MODE !== 'production') return next();
  const expected = (process.env.ADMIN_API_TOKEN || '').trim();
  const supplied = String(req.headers['x-mr-scrap-admin-token'] || '').trim();
  if (!expected || !supplied || !secureEquals(expected, supplied)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

interface SocialUrlValidation {
  ok: boolean;
  url: string;
  platform: 'facebook' | 'instagram' | 'other';
  error: string;
}

function validateSocialUrl(input: unknown): SocialUrlValidation {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, url: '', platform: 'other', error: 'URL is required' };
  }
  try {
    const parsed = new URL(input.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, url: '', platform: 'other', error: 'Only http/https URLs are allowed' };
    }
    const host = parsed.hostname.toLowerCase();
    const facebook = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
    const instagram = host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
    if (!facebook && !instagram) {
      return { ok: false, url: '', platform: 'other', error: 'Only Facebook and Instagram URLs are supported' };
    }
    parsed.hash = '';
    return { ok: true, url: parsed.toString(), platform: instagram ? 'instagram' : 'facebook', error: '' };
  } catch {
    return { ok: false, url: '', platform: 'other', error: 'Invalid URL' };
  }
}

function sanitizeOptionalUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  try {
    const parsed = new URL(input.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.toString().slice(0, 4096);
  } catch {
    return undefined;
  }
}

app.get('/api/health', (_req, res) => {
  const ai = getAIConfigurationStatus();
  res.json({
    status: 'ok',
    service: 'MR SCRAP Social Radar Server',
    databaseType: db.isUsingPostgres() ? 'postgresql' : 'file_persistence',
    aiConfigured: ai.configured,
    monitoringMode: sourceConnectorManager.getPrimaryMonitoringMode(),
    optionalPublicProviderConfigured: sourceConnectorManager.isApifyConfigured(),
    appMode: APP_MODE,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (_req, res) => {
  const ai = getAIConfigurationStatus();
  res.json({
    appMode: APP_MODE,
    isPostgres: db.isUsingPostgres(),
    aiConfigured: ai.configured,
    monitoringMode: sourceConnectorManager.getPrimaryMonitoringMode(),
    optionalPublicProviderConfigured: sourceConnectorManager.isApifyConfigured()
  });
});

app.post('/api/auth/device/register', rateLimiter(8, 60_000), async (req, res) => {
  try {
    const registration = await registerDevice(req.body?.platform);
    res.status(201).json(registration);
  } catch (error) {
    res.status(503).json({ error: safeError(error) });
  }
});

app.get('/api/internal/ai/health', rateLimiter(5, 60_000), requireInternalAdmin, async (_req, res) => {
  const result = await testConfiguredAIProvider();
  res.status(result.reachable ? 200 : 503).json(result);
});

app.get('/api/sources', async (_req, res) => {
  try {
    res.json(await db.getSources('user_default'));
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/sources', rateLimiter(30, 60_000), async (req, res) => {
  try {
    const { externalId, url, name, handle, avatarUrl, bio, visibilityType, connectorType } = req.body || {};
    const checkedUrl = validateSocialUrl(url);
    if (!checkedUrl.ok) return res.status(400).json({ error: checkedUrl.error });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });

    const normalizedConnector = connectorType === 'public_cloud' || connectorType === 'official_meta' ? connectorType : 'device_session';
    const resolvedExternalId = typeof externalId === 'string' && externalId.trim()
      ? externalId.trim().slice(0, 255)
      : typeof handle === 'string' && handle.trim()
        ? handle.replace(/^@/, '').trim().slice(0, 255)
        : '';

    if (!resolvedExternalId && !isDemoMode()) {
      return res.status(400).json({ error: 'A real resolved source externalId or handle is required in production' });
    }
    const normalizedExternalId = resolvedExternalId || `demo_source_${Date.now()}`;

    const source = await db.createSource({
      id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      user_id: 'user_default',
      platform: checkedUrl.platform === 'instagram' ? 'instagram' : 'facebook',
      external_id: normalizedExternalId,
      url: checkedUrl.url,
      name: name.trim().slice(0, 255),
      handle: typeof handle === 'string' ? handle.slice(0, 255) : undefined,
      avatar_url: sanitizeOptionalUrl(avatarUrl),
      bio: typeof bio === 'string' ? bio.slice(0, 5000) : undefined,
      visibility_type: visibilityType === 'public' ? 'public' : 'authenticated',
      connector_type: normalizedConnector,
      connector_status: normalizedConnector === 'device_session' ? 'needs_relogin' : 'connected',
      is_paused: false,
      consecutive_failures: 0,
      metadata: {}
    });

    res.status(201).json(source);
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.delete('/api/sources/:id', async (req, res) => {
  try {
    await db.deleteSource(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.patch('/api/sources/:id/pause', async (req, res) => {
  try {
    const paused = await db.toggleSourcePause(req.params.id);
    res.json({ success: true, isPaused: paused });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/sources/resolve', rateLimiter(20, 60_000), async (req, res) => {
  try {
    const checked = validateSocialUrl(req.body?.url);
    if (!checked.ok) return res.status(400).json({ error: checked.error });

    // Demo behavior is controlled only by server APP_MODE. A production client cannot request
    // fabricated/demo connector behavior by sending { demo: true }.
    const demo = isDemoMode();
    const result = await sourceConnectorManager.resolve({ url: checked.url }, demo);
    res.json({
      valid: result.valid,
      platform: result.platform,
      externalId: result.externalId,
      name: result.name,
      handle: result.handle,
      avatarUrl: result.avatarUrl,
      url: result.url,
      visibilityType: result.visibilityType,
      connectorType: result.connectorType,
      connectorStatus: result.connectorStatus,
      requiresAuthentication: result.requiresAuthentication,
      error: result.error
    });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.get('/api/rules', async (_req, res) => {
  try {
    res.json(await db.getRules('user_default'));
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/rules', rateLimiter(40, 60_000), async (req, res) => {
  try {
    const { name, naturalLanguage, includeTerms, excludeTerms, minConfidence, alertMode, collectionId, sourceIds } = req.body || {};
    if (typeof naturalLanguage !== 'string' || !naturalLanguage.trim()) {
      return res.status(400).json({ error: 'naturalLanguage is required' });
    }

    const rule = await db.createRule({
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      user_id: 'user_default',
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : 'Watch Rule',
      natural_language: naturalLanguage.trim().slice(0, 10_000),
      include_terms: Array.isArray(includeTerms) ? includeTerms.filter((v: any) => typeof v === 'string').slice(0, 50) : [],
      exclude_terms: Array.isArray(excludeTerms) ? excludeTerms.filter((v: any) => typeof v === 'string').slice(0, 50) : [],
      min_confidence: typeof minConfidence === 'number' ? Math.max(0, Math.min(1, minConfidence)) : 0.8,
      alert_mode: ['instant', 'digest', 'silent'].includes(alertMode) ? alertMode : 'instant',
      enabled: true,
      collection_id: typeof collectionId === 'string' ? collectionId.slice(0, 255) : undefined
    }, Array.isArray(sourceIds) ? sourceIds.filter((v: any) => typeof v === 'string').slice(0, 250) : []);

    res.status(201).json(rule);
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  try {
    await db.deleteRule(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.patch('/api/rules/:id/toggle', async (req, res) => {
  try {
    const enabled = await db.toggleRule(req.params.id);
    res.json({ success: true, enabled });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.get('/api/alerts', async (_req, res) => {
  try {
    res.json(await db.getMatches('user_default'));
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.patch('/api/alerts/:id', async (req, res) => {
  try {
    const { feedback, isRead, isSaved } = req.body || {};
    const normalizedFeedback = feedback === 'relevant' || feedback === 'not_relevant' ? feedback : undefined;
    await db.updateMatch(req.params.id, {
      feedback: normalizedFeedback,
      is_read: typeof isRead === 'boolean' ? isRead : undefined,
      is_saved: typeof isSaved === 'boolean' ? isSaved : undefined
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/alerts/scan', rateLimiter(15, 60_000), async (_req, res) => {
  try {
    // Production can never be switched into demo scanning by a client request.
    const demo = isDemoMode();
    const scan = await monitoringWorker.runScan('user_default', demo);
    res.json({
      scanned: scan.sourcesScanned,
      deviceManagedSources: scan.deviceManagedSources,
      newPosts: scan.newPostsFound,
      matches: scan.matchesCreated,
      errors: scan.errors,
      timestamp: scan.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/device/ingest', rateLimiter(30, 60_000), requireDeviceAuth, async (req, res) => {
  try {
    const { sourceId, posts, locale } = req.body || {};
    if (typeof sourceId !== 'string' || !sourceId.trim()) return res.status(400).json({ error: 'sourceId is required' });
    if (!Array.isArray(posts)) return res.status(400).json({ error: 'posts must be an array' });
    if (posts.length > 50) return res.status(413).json({ error: 'Maximum 50 posts per ingestion request' });

    const result = await ingestDevicePosts(
      sourceId,
      posts,
      res.locals.userId || 'user_default',
      locale === 'ar' ? 'ar' : 'en'
    );
    res.json(result);
  } catch (error) {
    const message = safeError(error);
    const status = message === 'Source not found' ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

app.post('/api/ai/evaluate-post', rateLimiter(10, 60_000), requireInternalAdmin, async (req, res) => {
  try {
    const { post, rule, locale } = req.body || {};
    if (!post || !rule) return res.status(400).json({ error: 'post and rule are required' });
    res.json(await evaluatePostAgainstRule(post, rule, locale === 'ar' ? 'ar' : 'en'));
  } catch (error) {
    res.status(503).json({ error: safeError(error) });
  }
});

app.post('/api/ai/rule-suggestions', rateLimiter(20, 60_000), async (req, res) => {
  try {
    if (isDemoMode() && !getAIConfigurationStatus().configured) {
      return res.json({
        suggestions: [
          'Notify me when they announce discounts or limited offers',
          'Alert me when a major new product or service launches',
          'Tell me when they post important price changes',
          'Notify me about job vacancies or hiring announcements'
        ],
        demo: true
      });
    }

    const suggestions = await aiService.generateRuleSuggestions({
      sourceName: typeof req.body?.sourceName === 'string' ? req.body.sourceName.slice(0, 255) : undefined,
      platform: typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 50) : undefined,
      bio: typeof req.body?.bio === 'string' ? req.body.bio.slice(0, 5000) : undefined
    });
    res.json({ suggestions });
  } catch (error) {
    res.status(503).json({ error: safeError(error), suggestions: [] });
  }
});

app.post('/api/ai/generate-digest', rateLimiter(20, 60_000), async (req, res) => {
  try {
    const matches = Array.isArray(req.body?.matches) ? req.body.matches.slice(0, 20) : [];
    const locale = req.body?.locale === 'ar' ? 'ar' : 'en';

    if (matches.length === 0) {
      return res.json({
        summary: locale === 'ar' ? 'لا توجد إشارات مطابقة جديدة لتلخيصها.' : 'There are no new matched signals to summarize.',
        highlights: [],
        topAction: locale === 'ar' ? 'لا يلزم أي إجراء الآن.' : 'No action is required right now.'
      });
    }

    res.json(await aiService.generateDigest(matches, locale));
  } catch (error) {
    res.status(503).json({ error: safeError(error) });
  }
});

app.post('/api/ai/preview-match', rateLimiter(20, 60_000), async (req, res) => {
  try {
    const rule = typeof req.body?.ruleNaturalLanguage === 'string' ? req.body.ruleNaturalLanguage.trim().slice(0, 10_000) : '';
    if (!rule) return res.status(400).json({ error: 'ruleNaturalLanguage is required' });

    if (isDemoMode() && !getAIConfigurationStatus().configured) {
      return res.json({
        headline: 'Example matching alert',
        excerpt: 'Hypothetical preview content that satisfies your selected watch rule.',
        whyMatched: `Preview only: this example was generated to demonstrate the rule "${rule}".`,
        category: 'Demo Preview',
        demo: true
      });
    }

    const sourceName = typeof req.body?.sourceName === 'string' ? req.body.sourceName.slice(0, 255) : undefined;
    res.json(await aiService.generatePreview(rule, sourceName));
  } catch (error) {
    res.status(503).json({ error: safeError(error) });
  }
});

async function startServer() {
  await db.init();

  if (APP_MODE === 'production' && !db.isUsingPostgres()) {
    throw new Error('Production startup aborted: DATABASE_URL is missing/unreachable. Local JSON persistence is allowed only outside APP_MODE=production.');
  }

  await ensureCurrentBackendIdentity();

  const aiStatus = getAIConfigurationStatus();
  if (APP_MODE === 'production' && !aiStatus.configured) {
    throw new Error(`Production startup aborted: ${aiStatus.error || 'AI provider is not configured'}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MR SCRAP Social Radar Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Mode] ${APP_MODE}`);
    console.log(`[Database] ${db.isUsingPostgres() ? 'PostgreSQL' : 'local development store'}`);
    if (aiStatus.configured) {
      console.log(`[AI] ${aiStatus.providerName} / ${aiStatus.model} / ${aiStatus.format}`);
    }
  });
}

startServer().catch(error => {
  console.error('[Fatal startup error]', safeError(error));
  process.exitCode = 1;
});
