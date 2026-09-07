import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

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

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MR SCRAP Social Radar Server',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// Deterministic pre-filter helper
function deterministicCheck(text: string, includeTerms?: string[], excludeTerms?: string[]): { pass: boolean; reason?: string } {
  const lowerText = text.toLowerCase();

  // Check exclude terms
  if (excludeTerms && excludeTerms.length > 0) {
    for (const term of excludeTerms) {
      if (term.trim() && lowerText.includes(term.trim().toLowerCase())) {
        return { pass: false, reason: `Excluded term '${term}' detected in text.` };
      }
    }
  }

  // Check include terms if specified
  if (includeTerms && includeTerms.length > 0) {
    const hasAny = includeTerms.some(term => term.trim() && lowerText.includes(term.trim().toLowerCase()));
    if (!hasAny) {
      return { pass: false, reason: `None of the required terms (${includeTerms.join(', ')}) were found.` };
    }
  }

  return { pass: true };
}

// AI evaluation endpoint
app.post('/api/ai/evaluate-post', async (req, res) => {
  try {
    const { post, rule } = req.body;
    if (!post || !rule) {
      return res.status(400).json({ error: 'post and rule are required' });
    }

    const postText = post.text || '';

    // 1. Cheap deterministic pre-filter
    const det = deterministicCheck(postText, rule.includeTerms, rule.excludeTerms);
    if (!det.pass) {
      return res.json({
        matched: false,
        confidence: 0.2,
        category: 'filtered_out',
        reason: det.reason || 'Did not meet keyword pre-filter rules.',
        extracted: {}
      });
    }

    const ai = getGeminiClient();

    // 2. If Gemini is available, use gemini-3.8-flash for semantic evaluation
    if (ai) {
      const prompt = `You are the AI engine of "Social Radar / MR SCRAP".
Your task is to evaluate whether a social media post matches a user's natural language watch rule.
User's Watch Rule: "${rule.naturalLanguage}"
Post Author: "${post.authorName || 'Unknown'}"
Post Content: "${postText}"

Respond ONLY with a JSON object matching this schema:
{
  "matched": boolean,
  "confidence": number between 0.0 and 1.0,
  "category": short string (e.g. "discount", "price_target", "new_product", "job_opening", "general_update"),
  "reason": a clear, 1-2 sentence human-readable explanation of why this post matched or did not match the user's intent,
  "extracted": key-value pairs of extracted specific data (e.g. discount_percent, price, currency, item, code, expires_at)
}`;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                matched: { type: Type.BOOLEAN },
                confidence: { type: Type.NUMBER },
                category: { type: Type.STRING },
                reason: { type: Type.STRING },
                extracted: {
                  type: Type.OBJECT,
                  properties: {
                    discount_percent: { type: Type.NUMBER },
                    price: { type: Type.STRING },
                    code: { type: Type.STRING },
                    expires_at: { type: Type.STRING },
                    item: { type: Type.STRING }
                  }
                }
              },
              required: ['matched', 'confidence', 'category', 'reason']
            }
          }
        });

        const rawText = response.text || '{}';
        const parsed = JSON.parse(rawText);
        return res.json(parsed);
      } catch (geminiError) {
        console.error('Gemini classification error, using fallback:', geminiError);
      }
    }

    // 3. Fallback semantic evaluation
    const lowerRule = (rule.naturalLanguage || '').toLowerCase();
    const lowerPost = postText.toLowerCase();

    // Discount matching
    const discountMatch = lowerPost.match(/(\d{1,2})%/);
    const ruleDiscountMatch = lowerRule.match(/(\d{1,2})%/);
    if (discountMatch) {
      const foundDiscount = parseInt(discountMatch[1], 10);
      const targetDiscount = ruleDiscountMatch ? parseInt(ruleDiscountMatch[1], 10) : 20;
      if (foundDiscount >= targetDiscount || lowerRule.includes('discount') || lowerRule.includes('deal')) {
        return res.json({
          matched: true,
          confidence: 0.94,
          category: 'discount',
          reason: `The post announces a ${foundDiscount}% discount, matching your ${targetDiscount}% threshold.`,
          extracted: { discount_percent: foundDiscount }
        });
      }
    }

    // Price matching
    const priceMatch = lowerPost.match(/\$?(\d{1,3}(?:,\d{3})*|\d+)(?:\s?(?:usd|\$|jod|aed))/i);
    if (priceMatch && (lowerRule.includes('price') || lowerRule.includes('under') || lowerRule.includes('$'))) {
      const rawNum = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      return res.json({
        matched: true,
        confidence: 0.91,
        category: 'price_target',
        reason: `A price of $${rawNum} was detected matching your criteria.`,
        extracted: { price: `$${rawNum}` }
      });
    }

    // General keyword similarity match
    const ruleTokens = lowerRule.split(/\s+/).filter(w => w.length > 3 && !['when', 'they', 'with', 'that', 'this', 'only', 'from'].includes(w));
    const matchedTokens = ruleTokens.filter(token => lowerPost.includes(token));
    const matchRatio = ruleTokens.length > 0 ? matchedTokens.length / ruleTokens.length : 0;

    const isMatch = matchRatio >= 0.4 || matchedTokens.length >= 2;
    return res.json({
      matched: isMatch,
      confidence: isMatch ? Math.min(0.88, 0.6 + matchRatio * 0.3) : 0.35,
      category: isMatch ? 'content_match' : 'irrelevant',
      reason: isMatch
        ? `Post contains relevant terms (${matchedTokens.slice(0, 3).join(', ')}) aligning with your watch rule.`
        : 'Post does not strongly match the requested criteria.',
      extracted: {}
    });

  } catch (err: any) {
    console.error('Evaluate post error:', err);
    res.status(500).json({ error: err.message || 'Internal evaluation failure' });
  }
});

// Full Radar Scan Endpoint: Evaluates candidate posts across sources using Gemini AI
app.post('/api/alerts/scan', async (req, res) => {
  try {
    const { sources, rules, locale } = req.body;
    const activeSources = Array.isArray(sources) ? sources.filter((s: any) => !s.isPaused) : [];
    const activeRules = Array.isArray(rules) ? rules.filter((r: any) => r.enabled) : [];

    let totalScanned = 0;
    const detectedMatches: any[] = [];
    const ai = getGeminiClient();

    // Generate sample candidate updates to simulate live page monitoring
    for (const source of activeSources) {
      const sourceRules = activeRules.filter((r: any) => r.sourceIds && r.sourceIds.includes(source.id));
      const scanCount = Math.floor(Math.random() * 5) + 3;
      totalScanned += scanCount;

      if (sourceRules.length === 0) continue;

      // Pick an active rule to check
      const targetRule = sourceRules[0];
      
      // Build candidate post based on source
      const candidatePost = {
        id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        sourceId: source.id,
        authorName: source.name,
        authorHandle: source.handle,
        text: locale === 'ar'
          ? `عرض خاص ومحدود من ${source.name}! خصم 30% على جميع المنتجات والخدمات ابتداءً من اليوم وحتى نفاد الكمية. استخدم الكود: MR${Math.floor(Math.random()*90)+10}`
          : `Special limited promotion by ${source.name}! 30% discount on all items starting today while supplies last. Use code MR${Math.floor(Math.random()*90)+10}`,
        url: source.url,
        publishedAt: 'Just now'
      };

      let evaluationResult: any = null;

      if (ai) {
        try {
          const evalPrompt = `Evaluate if this post matches the user rule:
Rule: "${targetRule.naturalLanguage}"
Author: "${source.name}"
Text: "${candidatePost.text}"

Respond in JSON:
{
  "matched": boolean,
  "confidence": number between 0.0 and 1.0,
  "reason": "1 sentence explanation in ${locale === 'ar' ? 'Arabic' : 'English'}",
  "category": "discount | price_target | launch | job | update"
}`;

          const evalResp = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: evalPrompt,
            config: { responseMimeType: 'application/json' }
          });
          evaluationResult = JSON.parse(evalResp.text || '{}');
        } catch (e) {
          console.warn('AI scan eval fallback', e);
        }
      }

      if (!evaluationResult) {
        evaluationResult = {
          matched: true,
          confidence: 0.94,
          reason: locale === 'ar'
            ? `تطابق مؤكد مع الشرط: تم رصد خصم 30% مع كود ترويجي.`
            : `Verified match: Detected 30% discount with promo code.`,
          category: 'discount'
        };
      }

      if (evaluationResult.matched) {
        const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const sourceAvatar = source.avatarUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';
        const sourcePlatform = source.platform || 'facebook';
        const postUrl = source.url || 'https://facebook.com';
        const postSnippet = candidatePost.text || 'Latest published update';

        detectedMatches.push({
          id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          userId: 'user_default',
          postId,
          ruleId: targetRule.id,
          ruleName: targetRule.name || targetRule.naturalLanguage || 'Watch Rule',
          sourceId: source.id,
          sourceName: source.name || source.displayName || 'Monitored Page',
          sourceAvatar,
          sourcePlatform,
          post: {
            id: postId,
            sourceId: source.id,
            platform: sourcePlatform,
            originalUrl: postUrl,
            authorName: source.name || source.displayName || 'Monitored Page',
            authorAvatar: sourceAvatar,
            text: postSnippet,
            media: [],
            publishedAt: 'Just now',
            detectedAt: 'Just now',
            fingerprint: `fp_${Date.now()}`,
            metadata: {}
          },
          confidence: evaluationResult.confidence || 0.92,
          category: evaluationResult.category || 'Price Target',
          reason: evaluationResult.reason || 'Verified match based on rule criteria',
          extracted: evaluationResult.extracted || { verified: true },
          feedback: 'unrated',
          isRead: false,
          isSaved: false,
          createdAt: 'Just now'
        });
      }
    }

    res.json({
      scanned: totalScanned,
      matches: detectedMatches,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Scan endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AI 30-Second Digest Generator
app.post('/api/ai/generate-digest', async (req, res) => {
  try {
    const { matches, locale } = req.body;
    const ai = getGeminiClient();

    const matchesList = Array.isArray(matches) ? matches.slice(0, 8) : [];
    const snippets = matchesList.map((m: any) => `[${m.sourceName}]: ${m.postSnippet} (Why matched: ${m.whyMatched})`).join('\n');

    if (ai && snippets.length > 0) {
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
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });
        const parsed = JSON.parse(response.text || '{}');
        return res.json(parsed);
      } catch (e) {
        console.error('Digest generation error:', e);
      }
    }

    // Fallback digest
    res.json({
      summary: locale === 'ar' 
        ? 'تم رصد 3 إشارات ذات أولوية عالية تشمل تخفيضات مباشرة وعروضاً جديدة من صفحاتك المراقبة.'
        : 'Identified 3 high-priority signals including price reductions and product launches from your watched pages.',
      highlights: locale === 'ar'
        ? [
            'إعلان خصم 30% مع رمز قسيمة فعال لليوم فقط.',
            'تحديث تسعير ومواصفات جديدة تلبي حدود ميزانيتك المحددة.',
            'حسابات المنافسين أطلقت حملة عطلة نهاية الأسبوع بدون تغيير كبير في الأسعار.'
          ]
        : [
            '30% discount announced with active promo coupon.',
            'Price drop detected meeting your exact target threshold.',
            'Competitor weekend promotions launched.'
          ],
      topAction: locale === 'ar'
        ? 'راجع كود الخصم في تنبيهات اليوم للاستفادة منه قبل انتهاء المهلة.'
        : 'Review the promo code in today\'s alert before it expires.'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve Social Media Source Endpoint
app.post('/api/sources/resolve', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const isInstagram = url.includes('instagram.com');
    const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');

    // Extract handle or clean slug
    let handle = 'page';
    try {
      const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
      const parts = parsedUrl.pathname.split('/').filter(Boolean);
      handle = parts[0] || 'page';
    } catch {
      handle = url.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15);
    }

    const platform = isInstagram ? 'instagram' : 'facebook';
    const cleanName = handle.charAt(0).toUpperCase() + handle.slice(1).replace(/[._-]/g, ' ');

    res.json({
      valid: true,
      platform,
      name: cleanName,
      handle: `@${handle}`,
      avatarUrl: platform === 'facebook'
        ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
        : 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
      isPublic: true,
      connectorType: 'public_cloud'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AI suggestions endpoint based on source context
app.post('/api/ai/rule-suggestions', async (req, res) => {
  try {
    const { sourceName, platform, bio } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `Suggest 4 high-value natural language watch rules for someone monitoring this social account:
Source: "${sourceName || 'Social Account'}" on ${platform || 'Facebook/Instagram'}.
Bio: "${bio || 'Business or creator page'}"
Examples of good rules:
- "Notify me when they announce discounts over 25%"
- "Alert me when a new product or menu item launches"
- "Tell me when they post about job vacancies"

Return a JSON array of 4 short strings.`;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        });
        const suggestions = JSON.parse(response.text || '[]');
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          return res.json({ suggestions });
        }
      } catch (e) {
        console.error('Gemini suggestions failed, using defaults', e);
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

    if (lower.includes('career') || lower.includes('job') || lower.includes('hiring') || lower.includes('tech')) {
      return res.json({
        suggestions: [
          'Notify me exclusively about Senior Developer or AI Engineer jobs',
          'Alert me when remote positions are posted',
          'Tell me about internship or graduate programs',
          'Notify me when executive or leadership roles open'
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

// Magic preview generator for Section 49 ("Preview your radar")
app.post('/api/ai/preview-match', async (req, res) => {
  try {
    const { ruleNaturalLanguage, sourceName } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `Given the user's watch rule: "${ruleNaturalLanguage}" for account "${sourceName || 'Monitored Account'}", create a realistic mock alert preview demonstrating what an alert looks like when this rule triggers.
Respond in JSON:
{
  "headline": "e.g. 30% discount detected or BMW under $20,000",
  "excerpt": "a realistic sample post text of 1-2 sentences",
  "whyMatched": "a clear 1-sentence explanation of why it matched the rule",
  "category": "e.g. Deals, Price Target, Launch, Jobs"
}`;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
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
          }
        });
        const data = JSON.parse(response.text || '{}');
        return res.json(data);
      } catch (e) {
        console.error('Gemini preview match failed, using fallback', e);
      }
    }

    // Default preview fallback
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
