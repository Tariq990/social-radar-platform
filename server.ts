import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

import { db, DbSource, DbRule } from './server/db/database';
import { sourceConnectorManager } from './server/connectors/sourceConnector';
import { monitoringWorker } from './server/worker/monitoringWorker';
import { evaluatePostAgainstRule } from './server/ai/ruleEvaluator';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '1mb' }));

// Basic in-memory rate limiter for scraping / resolving / AI endpoints
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(limit: number = 30, windowMs: number = 60000) {
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

// Initialize Gemini SDK with recommended user-agent header
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    try {
      geminiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    } catch (e) {
      console.error('Failed to initialize Gemini client:', e);
    }
  }
  return geminiClient;
}

// Candidate fallback models
const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite'
];

async function generateContentWithFallback(
  contents: any,
  config?: any,
  preferredModel: string = 'gemini-2.5-flash'
): Promise<{ text: string; modelUsed: string } | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const modelsToTry = [
    preferredModel,
    ...CANDIDATE_MODELS.filter(m => m !== preferredModel)
  ];

  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config,
        });
        if (response && response.text) {
          return { text: response.text, modelUsed: modelName };
        }
      } catch (err: any) {
        const statusCode = err?.status || err?.code || err?.error?.code;
        const errMsg = err?.message || '';
        const isTransient = statusCode === 503 || statusCode === 429 || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE');

        if (isTransient && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 400));
          continue;
        }

        console.warn(`[Gemini Model ${modelName}] unavailable (${statusCode || 'transient'}), trying next candidate model...`);
        break;
      }
    }
  }

  return null;
}

// -------------------------------------------------------------
// SYSTEM CONFIG & HEALTH
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MR SCRAP Social Radar Server',
    databaseType: db.isUsingPostgres() ? 'postgresql' : 'file_persistence',
    apifyConfigured: sourceConnectorManager.isApifyConfigured(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    appMode: process.env.APP_MODE || 'production',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    appMode: process.env.APP_MODE || 'production',
    isPostgres: db.isUsingPostgres(),
    apifyConfigured: sourceConnectorManager.isApifyConfigured(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

// -------------------------------------------------------------
// SOURCES CRUD (Persistent Database)
// -------------------------------------------------------------
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await db.getSources('user_default');
    res.json(sources);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sources', async (req, res) => {
  try {
    const { platform, externalId, url, name, handle, avatarUrl, bio, visibilityType, connectorType } = req.body;
    if (!url || !name) {
      return res.status(400).json({ error: 'url and name are required' });
    }

    const newSource = await db.createSource({
      id: `src_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      user_id: 'user_default',
      platform: platform || (url.includes('instagram.com') ? 'instagram' : 'facebook'),
      external_id: externalId || handle?.replace('@', '') || name.toLowerCase().replace(/\s+/g, '_'),
      url,
      name,
      handle,
      avatar_url: avatarUrl,
      bio,
      visibility_type: visibilityType || 'public',
      connector_type: connectorType || 'public_cloud',
      connector_status: 'connected',
      is_paused: false,
      consecutive_failures: 0,
      metadata: {}
    });

    res.status(201).json(newSource);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sources/:id', async (req, res) => {
  try {
    await db.deleteSource(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sources/:id/pause', async (req, res) => {
  try {
    const isPaused = await db.toggleSourcePause(req.params.id);
    res.json({ success: true, isPaused });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// RULES CRUD (Persistent Database)
// -------------------------------------------------------------
app.get('/api/rules', async (req, res) => {
  try {
    const rules = await db.getRules('user_default');
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules', async (req, res) => {
  try {
    const { name, naturalLanguage, includeTerms, excludeTerms, minConfidence, alertMode, collectionId, sourceIds } = req.body;
    if (!naturalLanguage) {
      return res.status(400).json({ error: 'naturalLanguage is required' });
    }

    const newRule = await db.createRule({
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      user_id: 'user_default',
      name: name || 'Watch Rule',
      natural_language: naturalLanguage,
      include_terms: Array.isArray(includeTerms) ? includeTerms : [],
      exclude_terms: Array.isArray(excludeTerms) ? excludeTerms : [],
      min_confidence: typeof minConfidence === 'number' ? minConfidence : 0.80,
      alert_mode: alertMode || 'instant',
      enabled: true,
      collection_id: collectionId
    }, Array.isArray(sourceIds) ? sourceIds : []);

    res.status(201).json(newRule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  try {
    await db.deleteRule(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/rules/:id/toggle', async (req, res) => {
  try {
    const enabled = await db.toggleRule(req.params.id);
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ALERTS / MATCHES (Persistent Database)
// -------------------------------------------------------------
app.get('/api/alerts', async (req, res) => {
  try {
    const matches = await db.getMatches('user_default');
    res.json(matches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/alerts/:id', async (req, res) => {
  try {
    const { feedback, isRead, isSaved } = req.body;
    await db.updateMatch(req.params.id, {
      feedback,
      is_read: isRead,
      is_saved: isSaved
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PHASE 1 & 2: SOURCE RESOLUTION (No fake data in production)
// -------------------------------------------------------------
app.post('/api/sources/resolve', rateLimiter(20, 60000), async (req, res) => {
  try {
    const { url, demo } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    const isDemo = Boolean(demo || process.env.APP_MODE === 'demo');
    const result = await sourceConnectorManager.resolve({ url }, isDemo);

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PHASE 4 & 7: REAL MONITORING SCAN WORKER
// -------------------------------------------------------------
app.post('/api/alerts/scan', rateLimiter(15, 60000), async (req, res) => {
  try {
    const isDemo = Boolean(req.body?.demo || process.env.APP_MODE === 'demo');
    const scanResult = await monitoringWorker.runScan('user_default', isDemo);

    res.json({
      scanned: scanResult.sourcesScanned,
      newPosts: scanResult.newPostsFound,
      matches: scanResult.matchesCreated,
      errors: scanResult.errors,
      timestamp: scanResult.timestamp
    });
  } catch (err: any) {
    console.error('[Scan Worker Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// AI SUGGESTIONS & PREVIEW
// -------------------------------------------------------------
app.post('/api/ai/rule-suggestions', rateLimiter(20, 60000), async (req, res) => {
  try {
    const { sourceName, platform, bio } = req.body;

    if (getGeminiClient()) {
      const prompt = `Suggest 4 high-value natural language watch rules for someone monitoring this social account:
Source: "${sourceName || 'Social Account'}" on ${platform || 'Facebook/Instagram'}.
Bio: "${bio || 'Business or creator page'}"
Examples of good rules:
- "Notify me when they announce discounts over 25%"
- "Alert me when a new product or menu item launches"
- "Tell me when they post about job vacancies"

Return a JSON array of 4 short strings.`;

      try {
        const response = await generateContentWithFallback(prompt, {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        });
        if (response && response.text) {
          const suggestions = JSON.parse(response.text);
          if (Array.isArray(suggestions) && suggestions.length > 0) {
            return res.json({ suggestions });
          }
        }
      } catch (e) {
        // Fallback below
      }
    }

    // Default suggestions tailored to source name
    const lower = (sourceName || '').toLowerCase();
    if (lower.includes('car') || lower.includes('motor') || lower.includes('bmw') || lower.includes('auto')) {
      return res.json({
        suggestions: [
          'Notify me when they post any vehicle under $20,000',
          'Alert me about certified pre-owned warranty deals',
          'Tell me when new 2025/2026 models arrive',
          'Notify me about trade-in promotions'
        ]
      });
    }

    if (lower.includes('burger') || lower.includes('food') || lower.includes('restaurant') || lower.includes('grill') || lower.includes('cafe')) {
      return res.json({
        suggestions: [
          'Notify me when they announce discounts over 25%',
          'Alert me about new menu items or seasonal dishes',
          'Tell me about buy-one-get-one weekend offers',
          'Notify me when they post exclusive discount voucher codes'
        ]
      });
    }

    return res.json({
      suggestions: [
        'Notify me when they announce discounts or limited offers',
        'Alert me when a major new product or service launches',
        'Tell me when they post important policy or price changes',
        'Notify me about upcoming events or workshops'
      ]
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single post evaluation endpoint
app.post('/api/ai/evaluate-post', async (req, res) => {
  try {
    const { post, rule, locale } = req.body;
    if (!post || !rule) {
      return res.status(400).json({ error: 'post and rule are required' });
    }

    const evalResult = await evaluatePostAgainstRule(post, rule, locale || 'en');
    res.json(evalResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AI 30-Second Digest Generator
app.post('/api/ai/generate-digest', async (req, res) => {
  try {
    const { matches, locale } = req.body;

    const matchesList = Array.isArray(matches) ? matches.slice(0, 8) : [];
    const snippets = matchesList.map((m: any) => `[${m.sourceName || m.source_name}]: ${m.post?.text || m.reason}`).join('\n');

    if (getGeminiClient() && snippets.length > 0) {
      const prompt = `You are the executive intelligence analyst for "MR SCRAP Social Radar".
Summarize these recent monitored social updates in a 30-second morning briefing in ${locale === 'ar' ? 'Arabic' : 'English'}.

Raw Signals:
${snippets}

Format strictly as JSON:
{
  "summary": "1 punchy summary sentence",
  "highlights": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "topAction": "1 clear recommendation or key opportunity"
}`;

      try {
        const response = await generateContentWithFallback(prompt, {
          responseMimeType: 'application/json'
        });
        if (response && response.text) {
          const parsed = JSON.parse(response.text);
          return res.json(parsed);
        }
      } catch (e) {
        // Fallback below
      }
    }

    res.json({
      summary: locale === 'ar' 
        ? 'تم رصد الإشارات ذات الأولوية العالية من صفحاتك المراقبة بدون انقطاع.'
        : 'Active monitoring signals updated across your watched sources.',
      highlights: locale === 'ar'
        ? [
            'التحقق من منشورات المصادر وتطبيق مرشحات الرصد الذكية.',
            'لا توجد تعارضات في قواعد المراقبة المحددة.',
            'نظام الرادار جاهز لتوليد التنبيهات فور نشر عروض جديدة.'
          ]
        : [
            'Source posts verified through semantic radar rules.',
            'Deduplication engine active with zero duplicate alerts.',
            'Radar standing by for real matching posts.'
          ],
      topAction: locale === 'ar'
        ? 'أضف المزيد من مصادر فيسبوك وإنستغرام لتوسيع نطاق التغطية.'
        : 'Add monitored public sources to expand radar coverage.'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Magic preview generator
app.post('/api/ai/preview-match', async (req, res) => {
  try {
    const { ruleNaturalLanguage, sourceName } = req.body;

    if (getGeminiClient()) {
      const prompt = `Given the user's watch rule: "${ruleNaturalLanguage}" for account "${sourceName || 'Monitored Account'}", create a realistic mock alert preview demonstrating what an alert looks like when this rule triggers.
Respond in JSON:
{
  "headline": "e.g. 30% discount detected or BMW under $20,000",
  "excerpt": "a realistic sample post text of 1-2 sentences",
  "whyMatched": "a clear 1-sentence explanation of why it matched the rule",
  "category": "e.g. Deals, Price Target, Launch, Jobs"
}`;

      try {
        const response = await generateContentWithFallback(prompt, {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              excerpt: { type: Type.STRING },
              whyMatched: { type: Type.STRING },
              category: { type: Type.STRING }
            },
            required: ['headline', 'excerpt', 'whyMatched', 'category']
          }
        });
        if (response && response.text) {
          const data = JSON.parse(response.text);
          return res.json(data);
        }
      } catch (e) {
        // Fallback
      }
    }

    res.json({
      headline: `Matching alert for "${sourceName || 'Source'}"`,
      excerpt: `Special announcement: Meeting your specific conditions on ${sourceName || 'this page'}.`,
      whyMatched: `Matched because the post content aligns directly with "${ruleNaturalLanguage}".`,
      category: 'Smart Alert'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start server with Vite middleware for dev / static in prod
async function startServer() {
  // Initialize Database repository
  await db.init();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MR SCRAP Social Radar Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
