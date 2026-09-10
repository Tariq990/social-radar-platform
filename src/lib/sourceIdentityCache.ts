import { Source } from '../types';

const STORAGE_KEY = 'mrscrap_source_identity_cache_v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

interface CachedSourceIdentity {
  displayName?: string;
  avatarUrl?: string;
  handle?: string;
  updatedAt: number;
}

type IdentitySource = Pick<Source, 'platform' | 'url' | 'displayName' | 'avatarUrl' | 'handle' | 'externalId'>;

function normalize(value?: string): string {
  return (value || '').normalize('NFKC').trim().replace(/^@/, '').toLowerCase();
}

function safeAvatarUrl(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return '';
  }
}

function identityKey(source: Pick<IdentitySource, 'platform' | 'url'>): string {
  try {
    const parsed = new URL(source.url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.|web\.)/, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${source.platform}:${parsed.hostname}${path}${parsed.search}`.toLowerCase();
  } catch {
    return `${source.platform}:${source.url.trim().toLowerCase()}`;
  }
}

export function isGenericSourceIdentityName(value: string | undefined, source: Pick<IdentitySource, 'externalId' | 'handle'>): boolean {
  const name = normalize(value);
  const generic = new Set([
    'facebook', 'instagram', 'page', 'profile', 'home',
    normalize(source.externalId), normalize(source.handle)
  ].filter(Boolean));
  return !name || generic.has(name);
}

function readCache(): Record<string, CachedSourceIdentity> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const now = Date.now();
    const result: Record<string, CachedSourceIdentity> = {};
    for (const [key, raw] of Object.entries(parsed as Record<string, any>)) {
      if (!raw || typeof raw !== 'object') continue;
      const updatedAt = Number(raw.updatedAt || 0);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > MAX_AGE_MS) continue;
      const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim().slice(0, 255) : '';
      const avatarUrl = safeAvatarUrl(typeof raw.avatarUrl === 'string' ? raw.avatarUrl : '');
      const handle = typeof raw.handle === 'string' ? raw.handle.trim().replace(/^@/, '').slice(0, 255) : '';
      result[key] = { displayName: displayName || undefined, avatarUrl: avatarUrl || undefined, handle: handle || undefined, updatedAt };
    }
    return result;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedSourceIdentity>): void {
  try {
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Identity caching is best-effort. Backend/native resolution remains authoritative.
  }
}

/**
 * Stores only public source presentation metadata. Authentication/session material is never
 * accepted by this API and never written to localStorage.
 */
export function rememberSourceIdentity(source: IdentitySource): void {
  const displayName = isGenericSourceIdentityName(source.displayName, source) ? '' : source.displayName.trim().slice(0, 255);
  const avatarUrl = safeAvatarUrl(source.avatarUrl);
  const handle = source.handle?.trim().replace(/^@/, '').slice(0, 255) || '';
  if (!displayName && !avatarUrl) return;

  const cache = readCache();
  const key = identityKey(source);
  const previous = cache[key];
  cache[key] = {
    displayName: displayName || previous?.displayName,
    avatarUrl: avatarUrl || previous?.avatarUrl,
    handle: handle || previous?.handle,
    updatedAt: Date.now()
  };
  writeCache(cache);
}

export function mergeCachedSourceIdentity(source: Source): Source {
  const cached = readCache()[identityKey(source)];
  if (!cached) return source;

  const cachedName = cached.displayName && !isGenericSourceIdentityName(cached.displayName, source)
    ? cached.displayName
    : '';
  const currentAvatar = safeAvatarUrl(source.avatarUrl);
  const cachedAvatar = safeAvatarUrl(cached.avatarUrl);

  return {
    ...source,
    displayName: isGenericSourceIdentityName(source.displayName, source) && cachedName ? cachedName : source.displayName,
    avatarUrl: currentAvatar || cachedAvatar || source.avatarUrl,
    handle: source.handle?.trim() || cached.handle || source.handle
  };
}
