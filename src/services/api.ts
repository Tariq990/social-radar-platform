import { Capacitor, registerPlugin } from '@capacitor/core';
import { Source, WatchRule, AlertMatch, NormalizedPost, ConnectorStatus, ConnectorType, SourcePlatform } from '../types';
import { sanitizeTransportMetadata } from '../lib/privacy';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const DEFAULT_ANDROID_API_BASE_URL = 'https://mr-scrap-api-live.onrender.com';
const DEVICE_AUTH_STORAGE_KEY = 'mrscrap_backend_device_auth_v1';
const DEFAULT_API_TIMEOUT_MS = 45_000;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;

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
let authSessionPromise: Promise<AppAuthSessionResponse> | null = null;

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function resolvedApiBaseUrl(): string {
  const resolved = API_BASE_URL || (isNativeAndroid() ? DEFAULT_ANDROID_API_BASE_URL : '');
  if (isNativeAndroid() && resolved) {
    try {
      const parsed = new URL(resolved);
      if (parsed.protocol !== 'https:') throw new Error('Android API origin must use HTTPS.');
      return parsed.toString().replace(/\/+$/, '');
    } catch (error) {
      if (error instanceof Error && error.message === 'Android API origin must use HTTPS.') throw error;
      throw new Error('Android API origin is invalid.');
    }
  }
  return resolved;
}

export function getApiBaseUrl(): string {
  return resolvedApiBaseUrl();
}

function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  const baseUrl = resolvedApiBaseUrl();
  if (isNativeAndroid() && !baseUrl) throw new Error('Android build is missing a public HTTPS backend origin.');
  return `${baseUrl}${path}`;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_API_RESPONSE_BYTES) throw new Error('Backend response exceeded the 4 MB safety limit.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Backend response exceeded the 4 MB safety limit.');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const onUpstreamAbort = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener('abort', onUpstreamAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);
  const { signal: _ignoredSignal, ...restInit } = init || {};

  try {
    const response = await fetch(apiUrl(path), {
      credentials: 'include',
      ...restInit,
      signal: controller.signal
    });
    const raw = await readBoundedResponseText(response);
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
  } catch (error: any) {
    if (error?.name === 'AbortError' && !upstreamSignal?.aborted) throw new Error('Backend request timed out.');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', onUpstreamAbort);
  }
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
    typeof value.userId === 'string' && value.userId.length > 0 && value.userId.length <= 255 &&
    typeof value.deviceId === 'string' && value.deviceId.length > 0 && value.deviceId.length <= 255 &&
    typeof value.token === 'string' && value.token.length >= 24 && value.token.length <= 512
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
  if (authSessionPromise) return authSessionPromise;
  const controller = new AbortController();
  const timeoutMs = isNativeAndroid() ? 15_000 : 6_000;
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  authSessionPromise = requestJson<AppAuthSessionResponse>('/api/auth/me', { signal: controller.signal })
    .catch(error => {
      if (error instanceof ApiRequestError && error.status === 401) return { authenticated: false, user: null } as AppAuthSessionResponse;
      throw error;
    })
    .finally(() => {
      globalThis.clearTimeout(timeout);
      authSessionPromise = null;
    });
  return authSessionPromise;
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
  sourceMetadata?: {
    displayName?: string;
    avatarUrl?: string;
    handle?: string;
  };
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

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function safeSocialUrl(value: unknown, platform: SourcePlatform): string | undefined {
  const normalized = safeHttpsUrl(value);
  if (!normalized || (platform !== 'facebook' && platform !== 'instagram')) return undefined;
  const host = new URL(normalized).hostname.toLowerCase();
  const facebook = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch';
  const instagram = host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
  return (platform === 'facebook' ? facebook : instagram) ? normalized : undefined;
}

function normalizeMedia(value: unknown): NormalizedPost['media'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (!item || (item.type !== 'image' && item.type !== 'video')) return [];
    const url = safeHttpsUrl(item.url);
    if (!url) return [];
    const previewUrl = safeHttpsUrl(item.previewUrl);
    return [{ type: item.type, url, ...(previewUrl ? { previewUrl } : {}) }];
  }).slice(0, 20);
}

function normalizeIngestSourceMetadata(value: unknown): DeviceIngestResponse['sourceMetadata'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim().slice(0, 255) : '';
  const avatarUrl = safeHttpsUrl(raw.avatarUrl);
  const handle = typeof raw.handle === 'string' ? raw.handle.trim().replace(/^@/, '').slice(0, 255) : '';
  if (!displayName && !avatarUrl && !handle) return undefined;
  return {
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(handle ? { handle } : {})
  };
}

export async function apiCheckHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health');
}

export async function apiGetConfig(): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/config');
}

/** Normalize only real persisted server matches; malformed records are rejected. */
export function normalizeAlertMatch(raw: any): AlertMatch {
  if (!raw || typeof raw !== 'object') throw new Error('Malformed alert record');
  const id = raw.id;
  const postRaw = raw.post;
  const postId = raw.post_id || raw.postId || postRaw?.id;
  const ruleId = raw.rule_id || raw.ruleId;
  const sourceId = raw.source_id || raw.sourceId;
  if (![id, postId, ruleId, sourceId].every(v => typeof v === 'string' && v.length > 0)) throw new Error('Alert record is missing persistent identifiers');
  if (!postRaw || typeof postRaw !== 'object') throw new Error('Alert record is missing persisted post data');

  const platform = normalizeSourcePlatform(raw.source_platform || raw.sourcePlatform || postRaw.platform);
  if (platform === 'other') throw new Error('Alert record has an unsupported source platform');
  const originalUrl = safeSocialUrl(postRaw.canonical_url || postRaw.originalUrl, platform);
  if (!originalUrl) throw new Error('Alert post is missing a valid canonical social URL');
  const sourceName = typeof (raw.source_name || raw.sourceName || postRaw.author_name || postRaw.authorName) === 'string'
    ? String(raw.source_name || raw.sourceName || postRaw.author_name || postRaw.authorName).trim().slice(0, 255)
    : '';
  const sourceAvatar = safeHttpsUrl(raw.source_avatar || raw.sourceAvatar || postRaw.author_avatar || postRaw.authorAvatar) || '';
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
  if (!Number.isFinite(confidence)) throw new Error('Alert record has invalid confidence');

  const post: NormalizedPost = {
    id: typeof postRaw.id === 'string' && postRaw.id ? postRaw.id : postId,
    sourceId,
    platform,
    externalPostId: typeof (postRaw.external_id || postRaw.externalPostId) === 'string' ? (postRaw.external_id || postRaw.externalPostId) : undefined,
    originalUrl,
    authorName: sourceName,
    authorAvatar: sourceAvatar || undefined,
    text: typeof postRaw.text === 'string' ? postRaw.text : '',
    media: normalizeMedia(postRaw.media),
    publishedAt: typeof (postRaw.published_at || postRaw.publishedAt) === 'string' ? (postRaw.published_at || postRaw.publishedAt) : '',
    detectedAt: typeof (postRaw.created_at || postRaw.detectedAt) === 'string' ? (postRaw.created_at || postRaw.detectedAt) : '',
    fingerprint: typeof postRaw.fingerprint === 'string' && postRaw.fingerprint ? postRaw.fingerprint : (postRaw.external_id || originalUrl),
    metadata: postRaw.metadata && typeof postRaw.metadata === 'object' && !Array.isArray(postRaw.metadata) ? postRaw.metadata : {}
  };

  return {
    id,
    userId: typeof (raw.user_id || raw.userId) === 'string' ? (raw.user_id || raw.userId) : '',
    postId,
    ruleId,
    ruleName: typeof (raw.rule_name || raw.ruleName) === 'string' ? (raw.rule_name || raw.ruleName) : '',
    sourceId,
    sourceName,
    sourceAvatar,
    sourcePlatform: platform,
    post,
    confidence: Math.max(0, Math.min(1, confidence)),
    category: typeof raw.category === 'string' ? raw.category : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    extracted: raw.extracted && typeof raw.extracted === 'object' && !Array.isArray(raw.extracted) ? raw.extracted : {},
    feedback: raw.feedback === 'relevant' || raw.feedback === 'not_relevant' ? raw.feedback : 'unrated',
    isRead: Boolean(raw.is_read ?? raw.isRead),
    isSaved: Boolean(raw.is_saved ?? raw.isSaved),
    createdAt: typeof (raw.created_at || raw.createdAt) === 'string' ? (raw.created_at || raw.createdAt) : ''
  };
}

function normalizeSourceRecord(s: any): Source | null {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) return null;
  const platform = normalizeSourcePlatform(s.platform);
  if (platform === 'other') return null;
  const url = safeSocialUrl(s.url, platform);
  if (!url) return null;
  const connectorType: ConnectorType = s.connector_type === 'public_cloud' || s.connectorType === 'public_cloud'
    ? 'public_cloud'
    : s.connector_type === 'official_meta' || s.connectorType === 'official_meta'
      ? 'official_meta'
      : 'device_session';
  return {
    id: s.id,
    userId: typeof (s.user_id || s.userId) === 'string' ? (s.user_id || s.userId) : '',
    platform,
    externalId: typeof (s.external_id || s.externalId) === 'string' ? (s.external_id || s.externalId) : '',
    url,
    displayName: typeof (s.name || s.displayName) === 'string' ? (s.name || s.displayName) : '',
    handle: typeof s.handle === 'string' ? s.handle : '',
    avatarUrl: safeHttpsUrl(s.avatar_url || s.avatarUrl) || '',
    bio: typeof s.bio === 'string' ? s.bio : undefined,
    visibilityType: s.visibility_type === 'public' ? 'public' : 'authenticated',
    connectorType,
    connectorStatus: normalizeConnectorStatus(s.connector_status || s.connectorStatus),
    activeRulesCount: Math.max(0, Number(s.activeRulesCount || 0) || 0),
    lastCheckedAt: typeof (s.last_checked_at || s.lastCheckedAt) === 'string' ? (s.last_checked_at || s.lastCheckedAt) : '',
    isPaused: Boolean(s.is_paused ?? s.isPaused),
    recentPostsCount: Math.max(0, Number(s.recentPostsCount || 0) || 0)
  };
}

export async function apiFetchSources(): Promise<Source[]> {
  const data = await requestJson<any[]>('/api/sources');
  return (Array.isArray(data) ? data : []).map(normalizeSourceRecord).filter((source): source is Source => Boolean(source));
}

export async function apiCreateSource(source: any): Promise<Source> {
  const s = await requestJson<any>('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source)
  });
  const normalized = normalizeSourceRecord(s);
  if (!normalized) throw new Error('Backend returned an invalid source record');
  return normalized;
}

export async function apiDeleteSource(id: string): Promise<void> {
  await requestJson(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiToggleSourcePause(id: string): Promise<boolean> {
  const data = await requestJson<{ isPaused: boolean }>(`/api/sources/${encodeURIComponent(id)}/pause`, { method: 'PATCH' });
  return Boolean(data.isPaused);
}

function normalizeRuleRecord(r: any, fallbackSourceIds: string[] = []): WatchRule | null {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const rawConfidence = Number(r.min_confidence ?? r.minConfidence ?? 0.8);
  const sourceIdInput: unknown = r.source_ids || r.sourceIds;
  const sourceIds: string[] = Array.isArray(sourceIdInput)
    ? [...new Set<string>((sourceIdInput as unknown[]).filter((value: unknown): value is string => typeof value === 'string' && value.length > 0))]
    : fallbackSourceIds;
  return {
    id: r.id,
    userId: typeof (r.user_id || r.userId) === 'string' ? (r.user_id || r.userId) : '',
    name: typeof r.name === 'string' ? r.name : '',
    naturalLanguage: typeof (r.natural_language || r.naturalLanguage) === 'string' ? (r.natural_language || r.naturalLanguage) : '',
    includeTerms: Array.isArray(r.include_terms || r.includeTerms) ? (r.include_terms || r.includeTerms).filter((v: unknown): v is string => typeof v === 'string') : [],
    excludeTerms: Array.isArray(r.exclude_terms || r.excludeTerms) ? (r.exclude_terms || r.excludeTerms).filter((v: unknown): v is string => typeof v === 'string') : [],
    minConfidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.8,
    alertMode: r.alert_mode === 'silent' ? 'silent' : r.alert_mode === 'digest' ? 'digest' : 'instant',
    enabled: Boolean(r.enabled),
    collectionId: typeof (r.collection_id || r.collectionId) === 'string' ? (r.collection_id || r.collectionId) : undefined,
    sourceIds,
    createdAt: typeof (r.created_at || r.createdAt) === 'string' ? (r.created_at || r.createdAt) : ''
  };
}

export async function apiFetchRules(): Promise<WatchRule[]> {
  const data = await requestJson<any[]>('/api/rules');
  return (Array.isArray(data) ? data : []).map(r => normalizeRuleRecord(r)).filter((rule): rule is WatchRule => Boolean(rule));
}

export async function apiCreateRule(rule: any, sourceIds: string[] = []): Promise<WatchRule> {
  const r = await requestJson<any>('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rule, sourceIds })
  });
  const normalized = normalizeRuleRecord(r, sourceIds);
  if (!normalized) throw new Error('Backend returned an invalid rule record');
  return normalized;
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
  for (const record of Array.isArray(data) ? data : []) {
    try { normalized.push(normalizeAlertMatch(record)); }
    catch { if (import.meta.env.DEV) console.warn('[apiFetchAlerts] Ignoring malformed persisted alert record'); }
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
  for (const raw of Array.isArray(data?.matches) ? data.matches : []) {
    try { matches.push(normalizeAlertMatch(raw)); } catch { /* malformed match is ignored */ }
  }
  return {
    scanned: Math.max(0, Number(data?.scanned || 0) || 0),
    deviceManagedSources: Math.max(0, Number(data?.deviceManagedSources || 0) || 0),
    newPosts: Math.max(0, Number(data?.newPosts || 0) || 0),
    matches,
    errors: Array.isArray(data?.errors) ? data.errors : [],
    timestamp: typeof data?.timestamp === 'string' ? data.timestamp : ''
  };
}

async function ingestWithAuth(auth: ApiDeviceAuthSession, sourceId: string, posts: NormalizedPost[], locale: 'en' | 'ar'): Promise<any> {
  const payloadPosts = posts.slice(0, 50).map(post => ({
    externalPostId: post.externalPostId,
    originalUrl: post.originalUrl,
    authorName: post.authorName,
    authorAvatar: post.authorAvatar,
    text: post.text,
    media: post.media,
    publishedAt: post.publishedAt,
    metadata: sanitizeTransportMetadata(post.metadata)
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
    } else throw error;
  }

  const matches: AlertMatch[] = [];
  for (const raw of Array.isArray(data?.matchesCreated) ? data.matchesCreated : []) {
    try { matches.push(normalizeAlertMatch(raw)); } catch { /* ignore malformed response records */ }
  }
  return {
    accepted: Math.max(0, Number(data?.accepted || 0) || 0),
    duplicates: Math.max(0, Number(data?.duplicates || 0) || 0),
    rejected: Math.max(0, Number(data?.rejected || 0) || 0),
    matchesCreated: matches,
    evaluationErrors: Array.isArray(data?.evaluationErrors) ? data.evaluationErrors : [],
    sourceMetadata: normalizeIngestSourceMetadata(data?.sourceMetadata)
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
  return Array.isArray(data.suggestions) ? data.suggestions.filter((value): value is string => typeof value === 'string').slice(0, 20) : [];
}

export async function apiPreviewMatch(ruleNaturalLanguage: string, sourceName?: string): Promise<any> {
  return requestJson('/api/ai/preview-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruleNaturalLanguage, sourceName })
  });
}

export async function apiGenerateDigest(_matches: AlertMatch[], locale: 'en' | 'ar'): Promise<DigestResponse> {
  return requestJson<DigestResponse>('/api/ai/generate-digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale })
  });
}
