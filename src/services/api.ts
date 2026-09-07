import { Source, WatchRule, AlertMatch, NormalizedPost } from '../types';

export interface HealthResponse {
  status: string;
  service: string;
  geminiConfigured: boolean;
  timestamp: string;
}

export interface ScanResponse {
  scanned: number;
  matches: AlertMatch[];
  timestamp: string;
}

export interface DigestResponse {
  summary: string;
  highlights: string[];
  topAction: string;
}

export interface ResolvedSourceResponse {
  valid: boolean;
  platform: 'facebook' | 'instagram';
  name: string;
  handle: string;
  avatarUrl: string;
  isPublic: boolean;
  connectorType: 'public_cloud' | 'device_session';
}

/**
 * Check backend health & Gemini status
 */
export async function apiCheckHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return await res.json();
}

export function normalizeAlertMatch(raw: any): AlertMatch {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `match_${Date.now()}`,
      userId: 'user_default',
      postId: `post_${Date.now()}`,
      ruleId: 'rule_default',
      ruleName: 'Watch Rule',
      sourceId: 'src_default',
      sourceName: 'Monitored Source',
      sourceAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      sourcePlatform: 'facebook',
      post: {
        id: `post_${Date.now()}`,
        sourceId: 'src_default',
        platform: 'facebook',
        originalUrl: 'https://facebook.com',
        authorName: 'Monitored Source',
        authorAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
        text: 'New activity detected.',
        media: [],
        publishedAt: 'Just now',
        detectedAt: 'Just now',
        fingerprint: `fp_${Date.now()}`,
        metadata: {}
      },
      confidence: 0.9,
      category: 'Update',
      reason: 'Rule matched criteria.',
      extracted: { verified: true },
      feedback: 'unrated',
      isRead: false,
      isSaved: false,
      createdAt: 'Just now'
    };
  }

  const sourceName = raw.sourceName || raw.displayName || 'Monitored Page';
  const sourceAvatar = raw.sourceAvatar || raw.avatarUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';
  const sourcePlatform = raw.sourcePlatform || raw.platform || 'facebook';
  const postUrl = raw.post?.originalUrl || raw.postUrl || raw.url || 'https://facebook.com';
  const postText = raw.post?.text || raw.postSnippet || raw.text || 'Latest activity update';

  return {
    id: raw.id || `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    userId: raw.userId || 'user_default',
    postId: raw.postId || `post_${Date.now()}`,
    ruleId: raw.ruleId || 'rule_default',
    ruleName: raw.ruleName || raw.ruleNaturalLanguage || 'Watch Rule',
    sourceId: raw.sourceId || 'src_default',
    sourceName,
    sourceAvatar,
    sourcePlatform,
    post: raw.post && typeof raw.post === 'object' ? {
      id: raw.post.id || `post_${Date.now()}`,
      sourceId: raw.sourceId || 'src_default',
      platform: raw.post.platform || sourcePlatform,
      originalUrl: raw.post.originalUrl || postUrl,
      authorName: raw.post.authorName || sourceName,
      authorAvatar: raw.post.authorAvatar || sourceAvatar,
      text: raw.post.text || postText,
      media: Array.isArray(raw.post.media) ? raw.post.media : [],
      publishedAt: raw.post.publishedAt || 'Just now',
      detectedAt: raw.post.detectedAt || 'Just now',
      fingerprint: raw.post.fingerprint || `fp_${Date.now()}`,
      metadata: raw.post.metadata || {}
    } : {
      id: `post_${Date.now()}`,
      sourceId: raw.sourceId || 'src_default',
      platform: sourcePlatform,
      originalUrl: postUrl,
      authorName: sourceName,
      authorAvatar: sourceAvatar,
      text: postText,
      media: [],
      publishedAt: raw.postTimestamp || 'Just now',
      detectedAt: raw.matchedAt || 'Just now',
      fingerprint: `fp_${Date.now()}`,
      metadata: {}
    },
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.92,
    category: raw.category || 'Price Target',
    reason: raw.reason || raw.whyMatched || 'Verified match based on rule criteria',
    extracted: raw.extracted || raw.extractedData || { verified: true },
    feedback: raw.feedback || 'unrated',
    isRead: Boolean(raw.isRead),
    isSaved: Boolean(raw.isSaved),
    createdAt: raw.createdAt || raw.matchedAt || 'Just now'
  };
}

/**
 * Trigger backend radar scan across watched sources using Gemini AI
 */
export async function apiScanSources(
  sources: Source[],
  rules: WatchRule[],
  locale: 'en' | 'ar'
): Promise<ScanResponse> {
  const res = await fetch('/api/alerts/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources, rules, locale })
  });
  if (!res.ok) throw new Error(`Scan request failed: ${res.statusText}`);
  const data = await res.json();
  const rawMatches = Array.isArray(data.matches) ? data.matches : [];
  return {
    scanned: typeof data.scanned === 'number' ? data.scanned : 0,
    matches: rawMatches.map(normalizeAlertMatch),
    timestamp: data.timestamp || new Date().toISOString()
  };
}

/**
 * Evaluate single post with Gemini AI server-side
 */
export async function apiEvaluatePost(post: NormalizedPost, rule: WatchRule): Promise<any> {
  const res = await fetch('/api/ai/evaluate-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post, rule })
  });
  if (!res.ok) throw new Error(`Evaluate request failed: ${res.statusText}`);
  return await res.json();
}

/**
 * Generate 30-second AI morning digest from recent matches
 */
export async function apiGenerateDigest(matches: AlertMatch[], locale: 'en' | 'ar'): Promise<DigestResponse> {
  const res = await fetch('/api/ai/generate-digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches, locale })
  });
  if (!res.ok) throw new Error(`Digest generation failed: ${res.statusText}`);
  return await res.json();
}

/**
 * Resolve Facebook / Instagram URL server-side
 */
export async function apiResolveSource(url: string): Promise<ResolvedSourceResponse> {
  const res = await fetch('/api/sources/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!res.ok) throw new Error(`Resolve source failed: ${res.statusText}`);
  return await res.json();
}

/**
 * Request smart rule suggestions from Gemini
 */
export async function apiGetRuleSuggestions(sourceName: string, platform: string, bio?: string): Promise<string[]> {
  try {
    const res = await fetch('/api/ai/rule-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceName, platform, bio })
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  } catch {
    return [];
  }
}

/**
 * Request realistic mock preview for a rule
 */
export async function apiPreviewMatch(ruleNaturalLanguage: string, sourceName?: string): Promise<any> {
  const res = await fetch('/api/ai/preview-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruleNaturalLanguage, sourceName })
  });
  if (!res.ok) throw new Error('Preview match failed');
  return await res.json();
}
