import { Capacitor, registerPlugin } from '@capacitor/core';
import { Source, WatchRule, AlertMatch, NormalizedPost, ConnectorStatus, ConnectorType, SourcePlatform } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const DEVICE_AUTH_STORAGE_KEY = 'mrscrap_backend_device_auth_v1';

interface NativeBackendAuthPlugin {
  getBackendAuth(): Promise<{ configured: boolean; userId?: string; deviceId?: string; token?: string; platform?: string }>;
  saveBackendAuth(options: { userId: string; deviceId: string; token: string; platform: string }): Promise<{ saved: boolean }>;
  clearBackendAuth(): Promise<{ cleared: boolean }>;
}

const NativeBackendAuth = registerPlugin<NativeBackendAuthPlugin>('AuthenticatedSocialSession');

export interface ApiDeviceAuthSession {
  userId: string;
  deviceId: string;
  token: string;
  platform: 'web' | 'android' | 'ios';
}

export interface AppAuthUser {
  id: string;
  email: string;
  name: string;
  tier: string;
}

export interface AppAuthSessionResponse {
  authenticated: boolean;
  user: AppAuthUser | null;
}

class ApiRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let registrationPromise: Promise<ApiDeviceAuthSession> | null = null;

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  if (isNativeAndroid() && !API_BASE_URL) {
    throw new Error('Android build is missing VITE_API_BASE_URL. Rebuild the app with the public HTTPS backend origin.');
  }
  return `${API_BASE_URL}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...(init || {})
  });
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, body?.error || body?.message || `Request failed with HTTP ${response.status}`);
  }
  return body as T;
}

function detectClientPlatform(): 'web' | 'android' | 'ios' {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') return platform;
  }
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}

function validateDeviceAuth(value: any): ApiDeviceAuthSession | null {
  if (
    value &&
    typeof value.userId === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.token === 'string' &&
    value.token.length >= 24 && value.token.length <= 512
  ) {
    return {
      userId: value.userId,
      deviceId: value.deviceId,
      token: value.token,
      platform: value.platform === 'android' || value.platform === 'ios' ? value.platform : 'web'
    };
  }
  return null;
}

async function readStoredDeviceAuth(): Promise<ApiDeviceAuthSession | null> {
  if (isNativeAndroid()) {
    try {
      const native = await NativeBackendAuth.getBackendAuth();
      if (!native.configured) return null;
      return validateDeviceAuth(native);
    } catch {
      return null;
    }
  }

  try {
    const raw = localStorage.getItem(DEVICE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return validateDeviceAuth(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function persistDeviceAuth(session: ApiDeviceAuthSession): Promise<void> {
  if (isNativeAndroid()) {
    await NativeBackendAuth.saveBackendAuth(session);
    return;
  }
  localStorage.setItem(DEVICE_AUTH_STORAGE_KEY, JSON.stringify(session));
}

async function clearStoredDeviceAuth(): Promise<void> {
  if (isNativeAndroid()) {
    try { await NativeBackendAuth.clearBackendAuth(); } catch { /* re-registration will recover */ }
    return;
  }
  localStorage.removeItem(DEVICE_AUTH_STORAGE_KEY);
}

export async function apiGetAuthSession(): Promise<AppAuthSessionResponse> {
  return requestJson<AppAuthSessionResponse>('/api/auth/me');
}

export async function apiRegister(email: string, password: string, name?: string): Promise<AppAuthSessionResponse> {
  return requestJson<AppAuthSessionResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name })
  });
}

export async function apiLogin(email: string, password: string): Promise<AppAuthSessionResponse> {
  return requestJson<AppAuthSessionResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
}

export async function apiLogout(): Promise<void> {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    await clearStoredDeviceAuth();
  }
}

export async function apiLogoutAll(): Promise<void> {
  try {
    await requestJson('/api/auth/logout-all', { method: 'POST' });
  } finally {
    await clearStoredDeviceAuth();
  }
}

/**
 * Backend application-device authorization. This token is unrelated to Facebook login and
 * never contains Facebook cookies/session material. On Android it is encrypted at rest by an
 * AndroidKeyStore-backed native store rather than localStorage or WorkManager Data.
 * Registration is bound to the currently authenticated MR SCRAP application user.
 */
export async function ensureApiDeviceAuth(forceRefresh: boolean = false): Promise<ApiDeviceAuthSession> {
  if (!forceRefresh) {
    const stored = await readStoredDeviceAuth();
    if (stored) return stored;
  } else {
    await clearStoredDeviceAuth();
  }

  if (registrationPromise) return registrationPromise;

  registrationPromise = requestJson<ApiDeviceAuthSession>('/api/auth/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: detectClientPlatform() })
  }).then(async session => {
    const validated = validateDeviceAuth(session);
    if (!validated) throw new Error('Backend returned invalid device authorization');
    await persistDeviceAuth(validated);
    return validated;
  }).finally(() => {
    registrationPromise = null;
  });

  return registrationPromise;
}

export interface HealthResponse {
  status: string;
  service: string;
  databaseType: string;
  aiConfigured: boolean;
  monitoringMode: 'device_session' | 'optional_public_provider';
  optionalPublicProviderConfigured: boolean;
  appMode: 'production' | 'demo';
  timestamp: string;
}

export interface ConfigResponse {
  appMode: 'production' | 'demo';
  isPostgres: boolean;
  aiConfigured: boolean;
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
  rejected: number;
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

  const confidence = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
  if (!Number.isFinite(confidence)) throw new Error('Alert record has invalid confidence');

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
    userId: raw.user_id || raw.userId || '',
    postId,
    ruleId,
    ruleName: raw.rule_name || raw.ruleName || '',
    sourceId,
    sourceName,
    sourceAvatar,
    sourcePlatform: platform,
    post,
    confidence: Math.max(0, Math.min(1, confidence)),
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
    userId: s.user_id || s.userId || '',
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
    userId: s.user_id || '',
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
    userId: r.user_id || r.userId || '',
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
    userId: r.user_id || '',
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

async function ingestWithAuth(auth: ApiDeviceAuthSession, sourceId: string, posts: NormalizedPost[], locale: 'en' | 'ar'): Promise<any> {
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

  return requestJson<any>('/api/device/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MR-SCRAP-CLIENT': 'android-device-session',
      'Authorization': `Bearer ${auth.token}`
    },
    body: JSON.stringify({ sourceId, posts: payloadPosts, locale })
  });
}

export async function apiIngestDevicePosts(sourceId: string, posts: NormalizedPost[], locale: 'en' | 'ar'): Promise<DeviceIngestResponse> {
  let auth = await ensureApiDeviceAuth();
  let data: any;
  try {
    data = await ingestWithAuth(auth, sourceId, posts, locale);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      auth = await ensureApiDeviceAuth(true);
      data = await ingestWithAuth(auth, sourceId, posts, locale);
    } else {
      throw error;
    }
  }

  const matches: AlertMatch[] = [];
  for (const raw of Array.isArray(data.matchesCreated) ? data.matchesCreated : []) {
    try { matches.push(normalizeAlertMatch(raw)); } catch { /* ignore malformed response records */ }
  }
  return {
    accepted: Number(data.accepted || 0),
    duplicates: Number(data.duplicates || 0),
    rejected: Number(data.rejected || 0),
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
