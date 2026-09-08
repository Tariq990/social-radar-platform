import { Source, WatchRule, AlertMatch, NormalizedPost } from '../types';

export interface HealthResponse {
  status: string;
  service: string;
  databaseType: string;
  apifyConfigured: boolean;
  geminiConfigured: boolean;
  appMode: 'production' | 'demo';
  timestamp: string;
}

export interface ConfigResponse {
  appMode: 'production' | 'demo';
  isPostgres: boolean;
  apifyConfigured: boolean;
  geminiConfigured: boolean;
}

export interface ScanResponse {
  scanned: number;
  newPosts: number;
  matches: AlertMatch[];
  errors?: { sourceId: string; error: string }[];
  timestamp: string;
}

export interface DigestResponse {
  summary: string;
  highlights: string[];
  topAction: string;
}

export interface ResolvedSourceResponse {
  valid: boolean;
  platform: 'facebook' | 'instagram' | 'other';
  externalId: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  url: string;
  visibilityType: 'public' | 'authenticated';
  connectorType: 'public_cloud' | 'device_session' | 'official_meta';
  connectorStatus: 'connected' | 'error' | 'needs_attention' | 'needs_relogin';
  requiresAuthentication: boolean;
  error?: string;
}

/**
 * Check backend health & status
 */
export async function apiCheckHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return await res.json();
}

/**
 * Get system configuration (PostgreSQL, Apify, Gemini)
 */
export async function apiGetConfig(): Promise<ConfigResponse> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`Config request failed: ${res.statusText}`);
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

  const sourceName = raw.source_name || raw.sourceName || raw.displayName || 'Monitored Page';
  const sourceAvatar = raw.source_avatar || raw.sourceAvatar || raw.avatarUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';
  const sourcePlatform = raw.source_platform || raw.sourcePlatform || raw.platform || 'facebook';
  const postUrl = raw.post?.canonical_url || raw.post?.originalUrl || raw.postUrl || raw.url || 'https://facebook.com';
  const postText = raw.post?.text || raw.postSnippet || raw.text || 'Latest activity update';

  return {
    id: raw.id || `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    userId: raw.user_id || raw.userId || 'user_default',
    postId: raw.post_id || raw.postId || `post_${Date.now()}`,
    ruleId: raw.rule_id || raw.ruleId || 'rule_default',
    ruleName: raw.rule_name || raw.ruleName || 'Watch Rule',
    sourceId: raw.source_id || raw.sourceId || 'src_default',
    sourceName,
    sourceAvatar,
    sourcePlatform,
    post: raw.post && typeof raw.post === 'object' ? {
      id: raw.post.id || `post_${Date.now()}`,
      sourceId: raw.source_id || raw.sourceId || 'src_default',
      platform: raw.post.platform || sourcePlatform,
      originalUrl: raw.post.canonical_url || raw.post.originalUrl || postUrl,
      authorName: raw.post.author_name || raw.post.authorName || sourceName,
      authorAvatar: raw.post.author_avatar || raw.post.authorAvatar || sourceAvatar,
      text: raw.post.text || postText,
      media: Array.isArray(raw.post.media) ? raw.post.media : [],
      publishedAt: raw.post.published_at || raw.post.publishedAt || 'Just now',
      detectedAt: raw.post.created_at || raw.post.detectedAt || 'Just now',
      fingerprint: raw.post.fingerprint || `fp_${Date.now()}`,
      metadata: raw.post.metadata || {}
    } : {
      id: `post_${Date.now()}`,
      sourceId: raw.source_id || raw.sourceId || 'src_default',
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
    confidence: typeof raw.confidence === 'number' ? Number(raw.confidence) : 0.92,
    category: raw.category || 'Price Target',
    reason: raw.reason || raw.whyMatched || 'Verified match based on rule criteria',
    extracted: raw.extracted || raw.extractedData || { verified: true },
    feedback: raw.feedback || 'unrated',
    isRead: Boolean(raw.is_read ?? raw.isRead),
    isSaved: Boolean(raw.is_saved ?? raw.isSaved),
    createdAt: raw.created_at || raw.createdAt || 'Just now'
  };
}

// -------------------------------------------------------------
// SOURCES DATABASE API
// -------------------------------------------------------------

export async function apiFetchSources(): Promise<Source[]> {
  try {
    const res = await fetch('/api/sources');
    if (!res.ok) throw new Error('Failed to fetch sources');
    const data = await res.json();
    return (data || []).map((s: any) => ({
      id: s.id,
      userId: s.user_id || s.userId || 'user_default',
      platform: s.platform,
      externalId: s.external_id || s.externalId,
      url: s.url,
      displayName: s.name || s.displayName,
      handle: s.handle,
      avatarUrl: s.avatar_url || s.avatarUrl,
      bio: s.bio,
      visibilityType: s.visibility_type || s.visibilityType || 'public',
      connectorType: s.connector_type || s.connectorType || 'public_cloud',
      connectorStatus: s.connector_status || s.connectorStatus || 'connected',
      activeRulesCount: 1,
      lastCheckedAt: s.last_checked_at || 'Just now',
      isPaused: Boolean(s.is_paused ?? s.isPaused),
      consecutiveFailures: s.consecutive_failures || 0,
      lastError: s.last_error
    }));
  } catch (err) {
    console.warn('[apiFetchSources] Error, falling back to local cache', err);
    return [];
  }
}

export async function apiCreateSource(source: any): Promise<Source> {
  const res = await fetch('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source)
  });
  if (!res.ok) throw new Error(`Create source failed: ${res.statusText}`);
  const s = await res.json();
  return {
    id: s.id,
    userId: s.user_id,
    platform: s.platform,
    externalId: s.external_id,
    url: s.url,
    displayName: s.name,
    handle: s.handle,
    avatarUrl: s.avatar_url,
    bio: s.bio,
    visibilityType: s.visibility_type,
    connectorType: s.connector_type,
    connectorStatus: s.connector_status,
    activeRulesCount: 1,
    lastCheckedAt: 'Just now',
    isPaused: Boolean(s.is_paused)
  };
}

export async function apiDeleteSource(id: string): Promise<void> {
  await fetch(`/api/sources/${id}`, { method: 'DELETE' });
}

export async function apiToggleSourcePause(id: string): Promise<boolean> {
  const res = await fetch(`/api/sources/${id}/pause`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Toggle pause failed');
  const data = await res.json();
  return Boolean(data.isPaused);
}

// -------------------------------------------------------------
// RULES DATABASE API
// -------------------------------------------------------------

export async function apiFetchRules(): Promise<WatchRule[]> {
  try {
    const res = await fetch('/api/rules');
    if (!res.ok) throw new Error('Failed to fetch rules');
    const data = await res.json();
    return (data || []).map((r: any) => ({
      id: r.id,
      userId: r.user_id || r.userId || 'user_default',
      name: r.name,
      naturalLanguage: r.natural_language || r.naturalLanguage,
      includeTerms: r.include_terms || r.includeTerms || [],
      excludeTerms: r.exclude_terms || r.excludeTerms || [],
      minConfidence: Number(r.min_confidence || r.minConfidence || 0.80),
      alertMode: r.alert_mode || r.alertMode || 'instant',
      enabled: Boolean(r.enabled),
      collectionId: r.collection_id || r.collectionId,
      sourceIds: r.source_ids || r.sourceIds || [],
      createdAt: r.created_at || r.createdAt
    }));
  } catch (err) {
    console.warn('[apiFetchRules] Error', err);
    return [];
  }
}

export async function apiCreateRule(rule: any, sourceIds: string[] = []): Promise<WatchRule> {
  const res = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rule, sourceIds })
  });
  if (!res.ok) throw new Error(`Create rule failed: ${res.statusText}`);
  const r = await res.json();
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    naturalLanguage: r.natural_language,
    includeTerms: r.include_terms,
    excludeTerms: r.exclude_terms,
    minConfidence: Number(r.min_confidence),
    alertMode: r.alert_mode,
    enabled: Boolean(r.enabled),
    collectionId: r.collection_id,
    sourceIds: r.source_ids || sourceIds,
    createdAt: r.created_at
  };
}

export async function apiDeleteRule(id: string): Promise<void> {
  await fetch(`/api/rules/${id}`, { method: 'DELETE' });
}

export async function apiToggleRule(id: string): Promise<boolean> {
  const res = await fetch(`/api/rules/${id}/toggle`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Toggle rule failed');
  const data = await res.json();
  return Boolean(data.enabled);
}

// -------------------------------------------------------------
// ALERTS DATABASE API
// -------------------------------------------------------------

export async function apiFetchAlerts(): Promise<AlertMatch[]> {
  try {
    const res = await fetch('/api/alerts');
    if (!res.ok) throw new Error('Failed to fetch alerts');
    const data = await res.json();
    return (data || []).map(normalizeAlertMatch);
  } catch (err) {
    console.warn('[apiFetchAlerts] Error', err);
    return [];
  }
}

export async function apiUpdateAlert(id: string, updates: { feedback?: string; isRead?: boolean; isSaved?: boolean }): Promise<void> {
  await fetch(`/api/alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}

// -------------------------------------------------------------
// SCAN WORKER API
// -------------------------------------------------------------

export async function apiScanSources(demo: boolean = false): Promise<ScanResponse> {
  const res = await fetch('/api/alerts/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demo })
  });
  if (!res.ok) throw new Error(`Scan request failed: ${res.statusText}`);
  const data = await res.json();
  const rawMatches = Array.isArray(data.matches) ? data.matches : [];
  return {
    scanned: typeof data.scanned === 'number' ? data.scanned : 0,
    newPosts: typeof data.newPosts === 'number' ? data.newPosts : 0,
    matches: rawMatches.map(normalizeAlertMatch),
    errors: data.errors,
    timestamp: data.timestamp || new Date().toISOString()
  };
}

// -------------------------------------------------------------
// RESOLVE & AI
// -------------------------------------------------------------

export async function apiResolveSource(url: string, demo: boolean = false): Promise<ResolvedSourceResponse> {
  const res = await fetch('/api/sources/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, demo })
  });
  if (!res.ok) throw new Error(`Resolve source failed: ${res.statusText}`);
  return await res.json();
}

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

export async function apiPreviewMatch(ruleNaturalLanguage: string, sourceName?: string): Promise<any> {
  const res = await fetch('/api/ai/preview-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruleNaturalLanguage, sourceName })
  });
  if (!res.ok) throw new Error('Preview match failed');
  return await res.json();
}

export async function apiGenerateDigest(matches: AlertMatch[], locale: 'en' | 'ar'): Promise<DigestResponse> {
  const res = await fetch('/api/ai/generate-digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches, locale })
  });
  if (!res.ok) throw new Error(`Digest generation failed: ${res.statusText}`);
  return await res.json();
}
