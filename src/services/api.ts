import { Source, WatchRule, AlertMatch, NormalizedPost, ConnectorStatus, ConnectorType, SourcePlatform } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${API_BASE_URL}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Request failed with HTTP ${response.status}`);
  }
  return body as T;
}

export interface HealthResponse {
  status: string;
  service: string;
  databaseType: string;
  aiConfigured: boolean;
  aiProvider?: string;
  aiModel?: string;
  aiFormat?: string;
  monitoringMode: 'device_session' | 'optional_public_provider';
  optionalPublicProviderConfigured: boolean;
  appMode: 'production' | 'demo';
  timestamp: string;
}

export interface ConfigResponse {
  appMode: 'production' | 'demo';
  isPostgres: boolean;
  aiConfigured: boolean;
  aiProvider?: string;
  aiModel?: string;
  aiFormat?: string;
  monitoringMode: 'device_session' | 'optional_public_provider';
  optionalPublicProviderConfigured: boolean;
}

export interface ScanResponse {
  scanned: number;
  deviceManagedSources: number;
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
  platform: SourcePlatform;
  externalId: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  url: string;
  visibilityType: 'public' | 'authenticated';
  connectorType: ConnectorType;
  connectorStatus: ConnectorStatus | 'error' | 'needs_attention';
  requiresAuthentication: boolean;
  error?: string;
}

export interface DeviceIngestResponse {
  accepted: number;
  duplicates: number;
  matchesCreated: AlertMatch[];
  evaluationErrors: { postId: string; ruleId: string; error: string }[];
}

function normalizeConnectorStatus(value: unknown): ConnectorStatus {
  switch (value) {
    case 'connected': return 'connected';
    case 'public_monitoring': return 'public_monitoring';
    case 'authenticated_monitoring': return 'authenticated_monitoring';
    case 'needs_relogin': return 'needs_relogin';
    case 'temporarily_unavailable':
    case 'error':
    case 'needs_attention':
      return 'temporarily_unavailable';
    default:
      return 'unsupported';
  }
}

function normalizeSourcePlatform(value: unknown): SourcePlatform {
  if (value === 'facebook' || value === 'instagram') return value;
  return 'other';
}

function normalizeMedia(value: unknown): NormalizedPost['media'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.type === 'image' || item.type === 'video') && typeof item.url === 'string')
    .map((item: any) => ({ type: item.type, url: item.url, previewUrl: item.previewUrl }));
}

export async function apiCheckHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health');
}

export async function apiGetConfig(): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/config');
}

/**
 * Normalize only real persisted server matches. Malformed records are rejected instead of
 * manufacturing source names, images, post text, confidence, or timestamps.
 */
export function normalizeAlertMatch(raw: any): AlertMatch {
  if (!raw || typeof raw !== 'object') throw new Error('Malformed alert record');
  const id = raw.id;
  const postRaw = raw.post;
  const postId = raw.post_id || raw.postId || postRaw?.id;
  const ruleId = raw.rule_id || raw.ruleId;
  const sourceId = raw.source_id || raw.sourceId;
  if (![id, postId, ruleId, sourceId].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('Alert record is missing persistent identifiers');
  }
  if (!postRaw || typeof postRaw !== 'object') throw new Error('Alert record is missing persisted post data');

  const sourceName = raw.source_name || raw.sourceName || postRaw.author_name || postRaw.authorName || '';
  const sourceAvatar = raw.source_avatar || raw.sourceAvatar || postRaw.author_avatar || postRaw.authorAvatar || '';
  const platform = normalizeSourcePlatform(raw.source_platform || raw.sourcePlatform || postRaw.platform);
  const originalUrl = postRaw.canonical_url || postRaw.originalUrl;
  if (typeof originalUrl !== 'string' || !originalUrl) throw new Error('Alert post is missing canonical URL');

  const post: NormalizedPost = {
    id: postRaw.id || postId,
    sourceId,
    platform,
    externalPostId: postRaw.external_id || postRaw.externalPostId,
    originalUrl,
    authorName: sourceName,
    authorAvatar: sourceAvatar || undefined,
    text: typeof postRaw.text === 'string' ? postRaw.text : '',
    media: normalizeMedia(postRaw.media),
    publishedAt: postRaw.published_at || postRaw.publishedAt || '',
    detectedAt: postRaw.created_at || postRaw.detectedAt || '',
    fingerprint: postRaw.fingerprint || postRaw.external_id || originalUrl,
    metadata: postRaw.metadata && typeof postRaw.metadata === 'object' ? postRaw.metadata : {}
  };

  return {
    id,
    userId: raw.user_id || raw.userId || 'user_default',
    postId,
    ruleId,
    ruleName: raw.rule_name || raw.ruleName || '',
    sourceId,
    sourceName,
    sourceAvatar,
    sourcePlatform: platform,
    post,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence),
    category: typeof raw.category === 'string' ? raw.category : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    extracted: raw.extracted && typeof raw.extracted === 'object' ? raw.extracted : {},
    feedback: raw.feedback === 'relevant' || raw.feedback === 'not_relevant' ? raw.feedback : 'unrated',
    isRead: Boolean(raw.is_read ?? raw.isRead),
    isSaved: Boolean(raw.is_saved ?? raw.isSaved),
    createdAt: raw.created_at || raw.createdAt || ''
  };
}

export async function apiFetchSources(): Promise<Source[]> {
  const data = await requestJson<any[]>('/api/sources');
  return (data || []).map((s: any) => ({
    id: s.id,
    userId: s.user_id || s.userId || 'user_default',
    platform: normalizeSourcePlatform(s.platform),
    externalId: s.external_id || s.externalId || '',
    url: s.url || '',
    displayName: s.name || s.displayName || '',
    handle: s.handle || '',
    avatarUrl: s.avatar_url || s.avatarUrl || '',
    bio: s.bio,
    visibilityType: s.visibility_type === 'public' ? 'public' : 'authenticated',
    connectorType: (s.connector_type || s.connectorType || 'device_session') as ConnectorType,
    connectorStatus: normalizeConnectorStatus(s.connector_status || s.connectorStatus),
    activeRulesCount: Number(s.activeRulesCount || 0),
    lastCheckedAt: s.last_checked_at || s.lastCheckedAt || '',
    isPaused: Boolean(s.is_paused ?? s.isPaused),
    recentPostsCount: Number(s.recentPostsCount || 0)
  }));
}

export async function apiCreateSource(source: any): Promise<Source> {
  const s = await requestJson<any>('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source)
  });
  return {
    id: s.id,
    userId: s.user_id || 'user_default',
    platform: normalizeSourcePlatform(s.platform),
    externalId: s.external_id || '',
    url: s.url || '',
    displayName: s.name || '',
    handle: s.handle || '',
    avatarUrl: s.avatar_url || '',
    bio: s.bio,
    visibilityType: s.visibility_type === 'public' ? 'public' : 'authenticated',
    connectorType: (s.connector_type || 'device_session') as ConnectorType,
    connectorStatus: normalizeConnectorStatus(s.connector_status),
    activeRulesCount: 0,
    lastCheckedAt: s.last_checked_at || '',
    isPaused: Boolean(s.is_paused)
  };
}

export async function apiDeleteSource(id: string): Promise<void> {
  await requestJson(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiToggleSourcePause(id: string): Promise<boolean> {
  const data = await requestJson<{ isPaused: boolean }>(`/api/sources/${encodeURIComponent(id)}/pause`, { method: 'PATCH' });
  return Boolean(data.isPaused);
}

export async function apiFetchRules(): Promise<WatchRule[]> {
  const data = await requestJson<any[]>('/api/rules');
  return (data || []).map((r: any) => ({
    id: r.id,
    userId: r.user_id || r.userId || 'user_default',
    name: r.name || '',
    naturalLanguage: r.natural_language || r.naturalLanguage || '',
    includeTerms: r.include_terms || r.includeTerms || [],
    excludeTerms: r.exclude_terms || r.excludeTerms || [],
    minConfidence: Number(r.min_confidence ?? r.minConfidence ?? 0.8),
    alertMode: r.alert_mode === 'digest' ? 'digest' : 'instant',
    enabled: Boolean(r.enabled),
    collectionId: r.collection_id || r.collectionId,
    sourceIds: r.source_ids || r.sourceIds || [],
    createdAt: r.created_at || r.createdAt || ''
  }));
}

export async function apiCreateRule(rule: any, sourceIds: string[] = []): Promise<WatchRule> {
  const r = await requestJson<any>('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rule, sourceIds })
  });
  return {
    id: r.id,
    userId: r.user_id || 'user_default',
    name: r.name || '',
    naturalLanguage: r.natural_language || '',
    includeTerms: r.include_terms || [],
    excludeTerms: r.exclude_terms || [],
    minConfidence: Number(r.min_confidence ?? 0.8),
    alertMode: r.alert_mode === 'digest' ? 'digest' : 'instant',
    enabled: Boolean(r.enabled),
    collectionId: r.collection_id,
    sourceIds: r.source_ids || sourceIds,
    createdAt: r.created_at || ''
  };
}

export async function apiDeleteRule(id: string): Promise<void> {
  await requestJson(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiToggleRule(id: string): Promise<boolean> {
  const data = await requestJson<{ enabled: boolean }>(`/api/rules/${encodeURIComponent(id)}/toggle`, { method: 'PATCH' });
  return Boolean(data.enabled);
}

export async function apiFetchAlerts(): Promise<AlertMatch[]> {
  const data = await requestJson<any[]>('/api/alerts');
  const normalized: AlertMatch[] = [];
  for (const record of data || []) {
    try {
      normalized.push(normalizeAlertMatch(record));
    } catch (error) {
      console.warn('[apiFetchAlerts] Ignoring malformed persisted alert record', error);
    }
  }
  return normalized;
}

export async function apiUpdateAlert(id: string, updates: { feedback?: string; isRead?: boolean; isSaved?: boolean }): Promise<void> {
  await requestJson(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}

export async function apiScanSources(demo: boolean = false): Promise<ScanResponse> {
  const data = await requestJson<any>('/api/alerts/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demo })
  });
  const matches: AlertMatch[] = [];
  for (const raw of Array.isArray(data.matches) ? data.matches : []) {
    try { matches.push(normalizeAlertMatch(raw)); } catch { /* malformed match is ignored */ }
  }
  return {
    scanned: Number(data.scanned || 0),
    deviceManagedSources: Number(data.deviceManagedSources || 0),
    newPosts: Number(data.newPosts || 0),
    matches,
    errors: Array.isArray(data.errors) ? data.errors : [],
    timestamp: data.timestamp || ''
  };
}

export async function apiIngestDevicePosts(sourceId: string, posts: NormalizedPost[], locale: 'en' | 'ar'): Promise<DeviceIngestResponse> {
  const payloadPosts = posts.map(post => ({
    externalPostId: post.externalPostId,
    originalUrl: post.originalUrl,
    authorName: post.authorName,
    authorAvatar: post.authorAvatar,
    text: post.text,
    media: post.media,
    publishedAt: post.publishedAt,
    metadata: post.metadata
  }));
  const data = await requestJson<any>('/api/device/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MR-SCRAP-CLIENT': 'android-device-session' },
    body: JSON.stringify({ sourceId, posts: payloadPosts, locale })
  });
  const matches: AlertMatch[] = [];
  for (const raw of Array.isArray(data.matchesCreated) ? data.matchesCreated : []) {
    try { matches.push(normalizeAlertMatch(raw)); } catch { /* ignore malformed response records */ }
  }
  return {
    accepted: Number(data.accepted || 0),
    duplicates: Number(data.duplicates || 0),
    matchesCreated: matches,
    evaluationErrors: Array.isArray(data.evaluationErrors) ? data.evaluationErrors : []
  };
}

export async function apiResolveSource(url: string, demo: boolean = false): Promise<ResolvedSourceResponse> {
  return requestJson<ResolvedSourceResponse>('/api/sources/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, demo })
  });
}

export async function apiGetRuleSuggestions(sourceName: string, platform: string, bio?: string): Promise<string[]> {
  const data = await requestJson<{ suggestions?: string[] }>('/api/ai/rule-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceName, platform, bio })
  });
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export async function apiPreviewMatch(ruleNaturalLanguage: string, sourceName?: string): Promise<any> {
  return requestJson('/api/ai/preview-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruleNaturalLanguage, sourceName })
  });
}

export async function apiGenerateDigest(matches: AlertMatch[], locale: 'en' | 'ar'): Promise<DigestResponse> {
  return requestJson<DigestResponse>('/api/ai/generate-digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches, locale })
  });
}
