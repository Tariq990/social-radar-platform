import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Source, WatchRule, AlertMatch, Collection, RadarDigest, UserProfile } from '../types';
import { INITIAL_SOURCES, INITIAL_RULES, INITIAL_MATCHES, INITIAL_COLLECTIONS } from '../data/seedData';
import { DeviceSessionConnector, NativeSessionStatus } from '../connectors/deviceSessionConnector';
import { Locale } from '../lib/i18n';
import { extractSupportedSocialUrl } from '../lib/socialUrl';
import { isGenericSourceIdentityName, mergeCachedSourceIdentity, rememberSourceIdentity } from '../lib/sourceIdentityCache';
import {
  apiCheckHealth,
  apiGetConfig,
  apiGetAuthSession,
  apiFetchSources,
  apiCreateSource,
  apiDeleteSource,
  apiToggleSourcePause,
  apiFetchRules,
  apiCreateRule,
  apiDeleteRule,
  apiToggleRule,
  apiFetchAlerts,
  apiUpdateAlert,
  apiScanSources,
  apiIngestDevicePosts,
  getApiBaseUrl
} from '../services/api';

interface RadarContextType {
  user: UserProfile;
  sources: Source[];
  rules: WatchRule[];
  matches: AlertMatch[];
  collections: Collection[];
  digest: RadarDigest;
  locale: Locale;
  theme: 'dark' | 'light';
  isScanning: boolean;
  backendStatus: 'online' | 'offline' | 'checking';
  isPostgres: boolean;
  aiConfigured: boolean;
  monitoringMode: 'device_session' | 'optional_public_provider';
  deviceSessionAvailable: boolean;
  apifyConfigured: boolean;
  geminiConfigured: boolean;
  isDemoMode: boolean;
  toggleDemoMode: () => void;
  selectedAlert: AlertMatch | null;
  selectedAlertDetail: AlertMatch | null;
  selectedSourceId: string | null;
  isAddSourceOpen: boolean;
  isPaywallOpen: boolean;
  isDigestOpen: boolean;
  currentScreen: 'radar' | 'watchlist' | 'alerts' | 'rules' | 'settings' | 'landing';
  sharedIncomingUrl: string | null;
  initialAddUrl: string | null;
  setLocale: (loc: Locale) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setCurrentScreen: (screen: 'radar' | 'watchlist' | 'alerts' | 'rules' | 'settings' | 'landing') => void;
  openAddSource: (url?: string) => void;
  closeAddSource: () => void;
  openAlertDetail: (alert: AlertMatch) => void;
  closeAlertDetail: () => void;
  openPaywall: () => void;
  closePaywall: () => void;
  openDigest: () => void;
  closeDigest: () => void;
  addSourceWithRule: (source: Omit<Source, 'id' | 'userId' | 'activeRulesCount' | 'lastCheckedAt' | 'isPaused'>, ruleNL: string, ruleName?: string) => Promise<void>;
  toggleSourcePause: (sourceId: string) => Promise<void>;
  deleteSource: (sourceId: string) => Promise<void>;
  addRule: (rule: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => Promise<void>;
  toggleRule: (ruleId: string) => Promise<void>;
  deleteRule: (ruleId: string) => Promise<void>;
  updateRule: (rule: WatchRule) => void;
  rateMatchFeedback: (matchId: string, feedback: 'relevant' | 'not_relevant') => Promise<void>;
  toggleSaveMatch: (matchId: string) => Promise<void>;
  markMatchRead: (matchId: string) => Promise<void>;
  scanAllSources: () => Promise<{ scanned: number; matched: number }>;
  resetToDemo: () => void;
  refreshDeviceSession: () => Promise<boolean>;
  connectFacebookSession: () => Promise<void>;
  disconnectFacebookSession: () => Promise<void>;
}

const RadarContext = createContext<RadarContextType | undefined>(undefined);

const STORAGE_KEYS = { LOCALE: 'mrscrap_locale_v2', THEME: 'mrscrap_theme_v2', DEMO_MODE: 'mrscrap_demo_mode_v2' };

const EMPTY_USER: UserProfile = {
  id: '', email: '', displayName: '', avatarUrl: '', plan: 'free', watchedSourcesCount: 0, activeRulesCount: 0, deviceSessionConnected: false,
  preferences: { language: 'en', theme: 'dark', pushEnabled: false, digestMode: 'instant' }
};

const EMPTY_DIGEST: RadarDigest = {
  id: 'live_digest', scannedCount: 0, matchedCount: 0, sourcesMonitored: 0, summary: '', summaryAr: '', highlights: [], highlightsAr: [], generatedAt: ''
};

function connectedAccountLabel(status: NativeSessionStatus): string | undefined {
  const facebook = status.facebookConnected === true;
  const instagram = status.instagramConnected === true;
  if (facebook && instagram) return 'Facebook + Instagram sessions on this device';
  if (facebook) return 'Facebook session on this device';
  if (instagram) return 'Instagram session on this device';
  return undefined;
}

interface IngestSourceMetadata {
  displayName?: string;
  avatarUrl?: string;
  handle?: string;
}

function withHealedSourceMetadata(source: Source, ingest: unknown): Source {
  const metadata = (ingest as { sourceMetadata?: IngestSourceMetadata } | null)?.sourceMetadata;
  if (!metadata) return source;
  const healed = {
    ...source,
    displayName: metadata.displayName?.trim() || source.displayName,
    avatarUrl: metadata.avatarUrl?.trim() || source.avatarUrl,
    handle: metadata.handle?.trim() || source.handle
  };
  rememberSourceIdentity(healed);
  return healed;
}

function isGenericVisibleSourceName(value: string | undefined, source: Pick<Source, 'externalId' | 'handle'>): boolean {
  return isGenericSourceIdentityName(value, source);
}

function sourceNeedsVisibleMetadata(source: Source): boolean {
  return source.connectorType === 'device_session' && (isGenericVisibleSourceName(source.displayName, source) || !source.avatarUrl?.trim());
}

export const RadarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => (localStorage.getItem(STORAGE_KEYS.LOCALE) as Locale) || 'en');
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => (localStorage.getItem(STORAGE_KEYS.THEME) as 'dark' | 'light') || 'dark');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [user, setUser] = useState<UserProfile>(EMPTY_USER);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [matches, setMatches] = useState<AlertMatch[]>([]);
  const [collections] = useState<Collection[]>(INITIAL_COLLECTIONS);
  const [digest, setDigest] = useState<RadarDigest>(EMPTY_DIGEST);
  const [isScanning, setIsScanning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [isPostgres, setIsPostgres] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [monitoringMode, setMonitoringMode] = useState<'device_session' | 'optional_public_provider'>('device_session');
  const [optionalPublicProviderConfigured, setOptionalPublicProviderConfigured] = useState(false);
  const [deviceSessionAvailable, setDeviceSessionAvailable] = useState(DeviceSessionConnector.isNativeAvailable());
  const [selectedAlert, setSelectedAlert] = useState<AlertMatch | null>(null);
  const [selectedSourceId] = useState<string | null>(null);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isDigestOpen, setIsDigestOpen] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<'radar' | 'watchlist' | 'alerts' | 'rules' | 'settings' | 'landing'>(() => {
    const screen = new URLSearchParams(window.location.search).get('screen');
    return screen && ['radar', 'watchlist', 'alerts', 'rules', 'settings', 'landing'].includes(screen) ? screen as any : 'landing';
  });
  const [sharedIncomingUrl, setSharedIncomingUrl] = useState<string | null>(null);
  const deviceConnector = useMemo(() => new DeviceSessionConnector(), []);

  const enrichVisibleSourceMetadata = async (candidates: Source[]) => {
    if (!DeviceSessionConnector.isNativeAvailable()) return;
    let status: NativeSessionStatus;
    try { status = await DeviceSessionConnector.getLocalSession(); } catch { return; }
    for (const source of candidates.filter(sourceNeedsVisibleMetadata)) {
      if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) continue;
      try {
        const resolved = await deviceConnector.resolveSource({ url: source.url });
        const realName = !isGenericVisibleSourceName(resolved.displayName, source) ? resolved.displayName.trim() : '';
        const avatarUrl = resolved.avatarUrl?.trim() || '';
        if (!realName && !avatarUrl) continue;
        const healedIdentity: Source = {
          ...source,
          displayName: realName || source.displayName,
          avatarUrl: avatarUrl || source.avatarUrl,
          handle: resolved.handle?.trim() || source.handle,
          connectorStatus: 'authenticated_monitoring'
        };
        rememberSourceIdentity(healedIdentity);
        setSources(previous => previous.map(item => item.id === source.id ? {
          ...item,
          displayName: realName || item.displayName,
          avatarUrl: avatarUrl || item.avatarUrl,
          handle: resolved.handle?.trim() || item.handle,
          connectorStatus: 'authenticated_monitoring'
        } : item));
      } catch { /* keep persisted metadata when the live profile cannot be resolved */ }
    }
  };

  const applyDeviceStatus = (status: NativeSessionStatus) => {
    setDeviceSessionAvailable(status.available);
    const connected = status.facebookConnected === true || status.instagramConnected === true;
    setUser(previous => ({
      ...previous,
      deviceSessionConnected: connected,
      deviceSessionAccount: connectedAccountLabel(status),
      deviceSessionLastChecked: status.lastCheckedAt || status.connectedAt || undefined
    }));
    if (status.available) {
      setSources(previous => previous.map(source => source.connectorType === 'device_session'
        ? {
            ...source,
            connectorStatus: DeviceSessionConnector.isPlatformConnected(status, source.platform)
              ? 'authenticated_monitoring'
              : 'needs_relogin'
          }
        : source));
    }
    return connected;
  };

  const refreshDeviceSession = async (): Promise<boolean> => applyDeviceStatus(await DeviceSessionConnector.getLocalSession());

  const loadDatabaseState = async (attempt: number = 0) => {
    try {
      const [health, config, auth] = await Promise.all([
        apiCheckHealth(), apiGetConfig(), apiGetAuthSession()
      ]);
      const serverDemo = config.appMode === 'demo';
      setIsDemoMode(serverDemo);
      if (serverDemo) localStorage.setItem(STORAGE_KEYS.DEMO_MODE, 'true'); else localStorage.removeItem(STORAGE_KEYS.DEMO_MODE);
      setBackendStatus(health.status === 'ok' ? 'online' : 'offline');
      setIsPostgres(Boolean(config.isPostgres));
      setAiConfigured(Boolean(config.aiConfigured));
      setMonitoringMode(config.monitoringMode || 'device_session');
      setOptionalPublicProviderConfigured(Boolean(config.optionalPublicProviderConfigured));

      if (!auth.authenticated || !auth.user) {
        setSources([]);
        setRules([]);
        setMatches([]);
        setDigest(previous => ({ ...previous, matchedCount: 0, sourcesMonitored: 0 }));
        setUser(previous => ({
          ...previous,
          id: '', email: '', displayName: '', plan: 'free', watchedSourcesCount: 0, activeRulesCount: 0
        }));
        return;
      }

      const [dbSources, dbRules, dbAlerts] = await Promise.all([
        apiFetchSources(), apiFetchRules(), apiFetchAlerts()
      ]);
      const uniqueMatchedPosts = new Map<string, Set<string>>();
      for (const alert of dbAlerts) {
        const set = uniqueMatchedPosts.get(alert.sourceId) || new Set<string>();
        set.add(alert.postId);
        uniqueMatchedPosts.set(alert.sourceId, set);
      }
      const cachedSources = dbSources.map(mergeCachedSourceIdentity);
      const hydratedSources = cachedSources.map(source => ({
        ...source,
        activeRulesCount: dbRules.filter(rule => rule.enabled && (rule.sourceIds.length === 0 || rule.sourceIds.includes(source.id))).length,
        recentPostsCount: Math.max(Number(source.recentPostsCount || 0), uniqueMatchedPosts.get(source.id)?.size || 0)
      }));
      setSources(hydratedSources);
      void enrichVisibleSourceMetadata(hydratedSources);
      setRules(dbRules);
      setMatches(dbAlerts);
      setDigest(previous => ({ ...previous, matchedCount: dbAlerts.length, sourcesMonitored: hydratedSources.length }));
      setUser(previous => ({
        ...previous,
        id: auth.user!.id,
        email: auth.user!.email,
        displayName: auth.user!.name || auth.user!.email,
        plan: auth.user!.tier === 'pro' || auth.user!.tier === 'power' ? auth.user!.tier : 'free',
        watchedSourcesCount: hydratedSources.length,
        activeRulesCount: dbRules.filter(rule => rule.enabled).length
      }));
    } catch (error) {
      console.warn('[RadarProvider] Backend state load failed', error);
      if (attempt < 1) {
        await new Promise(resolve => globalThis.setTimeout(resolve, 1_200));
        return loadDatabaseState(attempt + 1);
      }
      setBackendStatus('offline');
      setSources([]); setRules([]); setMatches([]);
    }
  };

  useEffect(() => {
    localStorage.removeItem(STORAGE_KEYS.DEMO_MODE);
    void (async () => {
      await loadDatabaseState();
      await refreshDeviceSession().catch(() => false);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem(STORAGE_KEYS.LOCALE, locale);
  }, [locale]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc');
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('url') || params.get('text') || params.get('share_url');
    const sharedUrl = raw ? extractSupportedSocialUrl(raw) : null;
    if (sharedUrl) {
      setSharedIncomingUrl(sharedUrl);
      setIsAddSourceOpen(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const nativeShareHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const url = detail?.text ? extractSupportedSocialUrl(detail.text) : null;
      if (!url) return;
      setSharedIncomingUrl(url);
      setCurrentScreen('radar');
      setIsAddSourceOpen(true);
    };
    window.addEventListener('mrscrap:share', nativeShareHandler as EventListener);
    return () => window.removeEventListener('mrscrap:share', nativeShareHandler as EventListener);
  }, []);

  const toggleDemoMode = () => console.warn('[Radar] Demo mode can only be enabled by APP_MODE=demo on the server.');
  const openAddSource = (url?: string) => {
    if (url) {
      const safeUrl = extractSupportedSocialUrl(url);
      if (!safeUrl) return;
      setSharedIncomingUrl(safeUrl);
    }
    setIsAddSourceOpen(true);
  };
  const closeAddSource = () => { setIsAddSourceOpen(false); setSharedIncomingUrl(null); };

  const addSourceWithRule = async (
    sourceData: Omit<Source, 'id' | 'userId' | 'activeRulesCount' | 'lastCheckedAt' | 'isPaused'>,
    ruleNL: string,
    ruleName?: string
  ) => {
    let persistedSource = await apiCreateSource({
      platform: sourceData.platform, externalId: sourceData.externalId, url: sourceData.url, name: sourceData.displayName,
      handle: sourceData.handle, avatarUrl: sourceData.avatarUrl, bio: sourceData.bio, visibilityType: sourceData.visibilityType, connectorType: sourceData.connectorType
    });
    rememberSourceIdentity({ ...persistedSource, ...sourceData });
    persistedSource = mergeCachedSourceIdentity(persistedSource);
    try {
      const persistedRule = await apiCreateRule({
        name: ruleName || `${persistedSource.displayName} Watch`, naturalLanguage: ruleNL, minConfidence: 0.82, alertMode: 'instant', collectionId: sourceData.collectionId
      }, [persistedSource.id]);
      const withRuleCount = { ...persistedSource, activeRulesCount: 1, connectorStatus: sourceData.connectorStatus };
      setSources(previous => [withRuleCount, ...previous.filter(source => source.id !== persistedSource.id)]);
      setRules(previous => [persistedRule, ...previous.filter(rule => rule.id !== persistedRule.id)]);
      setUser(previous => ({ ...previous, watchedSourcesCount: previous.watchedSourcesCount + 1, activeRulesCount: previous.activeRulesCount + 1 }));

      if (persistedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable()) {
        void (async () => {
          try {
            const backendBaseUrl = getApiBaseUrl();
            if (backendBaseUrl) await DeviceSessionConnector.scheduleBackgroundSource(persistedSource, backendBaseUrl, locale);
            const status = await DeviceSessionConnector.getLocalSession();
            applyDeviceStatus(status);
            if (!DeviceSessionConnector.isPlatformConnected(status, persistedSource.platform)) return;
            const posts = await deviceConnector.fetchLatest(persistedSource, 10);
            const ingest = await apiIngestDevicePosts(persistedSource.id, posts, locale);
            if (ingest.matchesCreated.length > 0) setMatches(previous => [...ingest.matchesCreated, ...previous]);
            setSources(previous => previous.map(source => source.id === persistedSource.id
              ? {
                  ...withHealedSourceMetadata(source, ingest),
                  connectorStatus: 'authenticated_monitoring',
                  recentPostsCount: Number(source.recentPostsCount || 0) + ingest.accepted,
                  lastCheckedAt: locale === 'ar' ? 'الآن' : 'Just now'
                }
              : source));
          } catch (error) { console.warn('[addSourceWithRule] Initial authenticated collection did not complete', error); }
        })();
      } else {
        void apiScanSources(isDemoMode).then(scan => { if (scan.matches.length > 0) setMatches(previous => [...scan.matches, ...previous]); }).catch(() => {});
      }
    } catch (error) {
      await apiDeleteSource(persistedSource.id).catch(() => {});
      throw error;
    }
  };

  const toggleSourcePause = async (sourceId: string) => {
    const source = sources.find(item => item.id === sourceId);
    if (!source) return;
    const optimisticPaused = !source.isPaused;
    setSources(previous => previous.map(item => item.id === sourceId ? { ...item, isPaused: optimisticPaused } : item));

    let serverPaused: boolean;
    try {
      serverPaused = await apiToggleSourcePause(sourceId);
      setSources(previous => previous.map(item => item.id === sourceId ? { ...item, isPaused: serverPaused } : item));
    } catch (error) {
      setSources(previous => previous.map(item => item.id === sourceId ? { ...item, isPaused: source.isPaused } : item));
      console.warn('Failed to toggle source pause', error);
      return;
    }

    if (source.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable()) {
      try {
        if (serverPaused) {
          await DeviceSessionConnector.cancelBackgroundSource(sourceId);
        } else {
          const backendBaseUrl = getApiBaseUrl();
          if (backendBaseUrl) await DeviceSessionConnector.scheduleBackgroundSource({ ...source, isPaused: false }, backendBaseUrl, locale);
        }
      } catch (error) {
        // The server state is authoritative. A local WorkManager failure must not roll the UI back
        // to a state that no longer matches the persisted source; the next reconciliation can retry.
        console.warn('Source pause state persisted but background scheduling did not reconcile', error);
      }
    }
  };

  const deleteSource = async (sourceId: string) => {
    const sourceSnapshot = sources;
    const ruleSnapshot = rules;
    const matchSnapshot = matches;
    const affectedRules = rules.filter(rule => rule.sourceIds.includes(sourceId));
    const orphanRuleIds = new Set(affectedRules.filter(rule => rule.sourceIds.length === 1).map(rule => rule.id));
    const enabledOrphans = affectedRules.filter(rule => rule.enabled && rule.sourceIds.length === 1).length;
    setSources(previous => previous.filter(source => source.id !== sourceId));
    try {
      if (DeviceSessionConnector.isNativeAvailable()) await DeviceSessionConnector.cancelBackgroundSource(sourceId);
      await apiDeleteSource(sourceId);
      setRules(previous => previous.flatMap(rule => {
        if (!rule.sourceIds.includes(sourceId)) return [rule];
        if (orphanRuleIds.has(rule.id)) return [];
        return [{ ...rule, sourceIds: rule.sourceIds.filter(id => id !== sourceId) }];
      }));
      setMatches(previous => previous.filter(match => match.sourceId !== sourceId && !orphanRuleIds.has(match.ruleId)));
      setUser(previous => ({
        ...previous,
        watchedSourcesCount: Math.max(0, previous.watchedSourcesCount - 1),
        activeRulesCount: Math.max(0, previous.activeRulesCount - enabledOrphans)
      }));
    } catch (error) {
      setSources(sourceSnapshot); setRules(ruleSnapshot); setMatches(matchSnapshot);
      console.warn('Failed to delete source', error);
    }
  };

  const addRule = async (ruleData: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => {
    const persisted = await apiCreateRule(ruleData, ruleData.sourceIds || []);
    setRules(previous => [persisted, ...previous]);
    setSources(previous => previous.map(source => (persisted.sourceIds.length === 0 || persisted.sourceIds.includes(source.id))
      ? { ...source, activeRulesCount: source.activeRulesCount + 1 } : source));
    setUser(previous => ({ ...previous, activeRulesCount: previous.activeRulesCount + 1 }));
  };

  const toggleRule = async (ruleId: string) => {
    const existing = rules.find(rule => rule.id === ruleId);
    if (!existing) return;
    const next = !existing.enabled;
    setRules(current => current.map(rule => rule.id === ruleId ? { ...rule, enabled: next } : rule));
    try {
      await apiToggleRule(ruleId);
      const delta = next ? 1 : -1;
      setSources(previous => previous.map(source => (existing.sourceIds.length === 0 || existing.sourceIds.includes(source.id))
        ? { ...source, activeRulesCount: Math.max(0, source.activeRulesCount + delta) } : source));
      setUser(previous => ({ ...previous, activeRulesCount: Math.max(0, previous.activeRulesCount + delta) }));
    } catch (error) {
      setRules(current => current.map(rule => rule.id === ruleId ? { ...rule, enabled: existing.enabled } : rule));
      throw error;
    }
  };

  const deleteRule = async (ruleId: string) => {
    const existing = rules.find(rule => rule.id === ruleId);
    await apiDeleteRule(ruleId);
    setRules(previous => previous.filter(rule => rule.id !== ruleId));
    setMatches(previous => previous.filter(match => match.ruleId !== ruleId));
    if (existing?.enabled) {
      setSources(previous => previous.map(source => (existing.sourceIds.length === 0 || existing.sourceIds.includes(source.id))
        ? { ...source, activeRulesCount: Math.max(0, source.activeRulesCount - 1) } : source));
      setUser(previous => ({ ...previous, activeRulesCount: Math.max(0, previous.activeRulesCount - 1) }));
    }
  };

  const updateRule = (updated: WatchRule) => setRules(previous => previous.map(rule => rule.id === updated.id ? updated : rule));
  const rateMatchFeedback = async (matchId: string, feedback: 'relevant' | 'not_relevant') => {
    await apiUpdateAlert(matchId, { feedback });
    setMatches(previous => previous.map(match => match.id === matchId ? { ...match, feedback } : match));
    setSelectedAlert(previous => previous?.id === matchId ? { ...previous, feedback } : previous);
  };
  const toggleSaveMatch = async (matchId: string) => {
    const current = matches.find(match => match.id === matchId);
    if (!current) return;
    const next = !current.isSaved;
    await apiUpdateAlert(matchId, { isSaved: next });
    setMatches(previous => previous.map(match => match.id === matchId ? { ...match, isSaved: next } : match));
    setSelectedAlert(previous => previous?.id === matchId ? { ...previous, isSaved: next } : previous);
  };
  const markMatchRead = async (matchId: string) => {
    await apiUpdateAlert(matchId, { isRead: true });
    setMatches(previous => previous.map(match => match.id === matchId ? { ...match, isRead: true } : match));
  };

  const scanAllSources = async (): Promise<{ scanned: number; matched: number }> => {
    setIsScanning(true);
    let matched = 0;
    let scanned = 0;
    try {
      const deviceSources = sources.filter(item => item.connectorType === 'device_session' && !item.isPaused);
      if (DeviceSessionConnector.isNativeAvailable() && deviceSources.length > 0) {
        const status = await DeviceSessionConnector.getLocalSession();
        applyDeviceStatus(status);
        // Authenticated collection creates real WebViews. Run sources sequentially so one manual
        // scan cannot create multiple heavyweight Meta renderers and race their lifecycle/CPU/RAM.
        for (const source of deviceSources) {
          if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) continue;
          try {
            const posts = await deviceConnector.fetchLatest(source, 10);
            const ingest = await apiIngestDevicePosts(source.id, posts, locale);
            if (ingest.matchesCreated.length > 0) setMatches(previous => [...ingest.matchesCreated, ...previous]);
            setSources(previous => previous.map(item => item.id === source.id
              ? {
                  ...withHealedSourceMetadata(item, ingest),
                  connectorStatus: 'authenticated_monitoring',
                  recentPostsCount: Number(item.recentPostsCount || 0) + ingest.accepted,
                  lastCheckedAt: locale === 'ar' ? 'الآن' : 'Just now'
                }
              : item));
            scanned += 1;
            matched += ingest.matchesCreated.length;
          } catch (error) {
            console.warn(`[Radar] Authenticated scan failed for ${source.id}`, error);
          }
        }
      }

      const hasServerManagedSources = sources.some(item => item.connectorType !== 'device_session' && !item.isPaused);
      if (hasServerManagedSources || isDemoMode) {
        const serverScan = await apiScanSources(isDemoMode);
        scanned += serverScan.scanned;
        matched += serverScan.matches.length;
        if (serverScan.matches.length > 0) setMatches(previous => [...serverScan.matches, ...previous]);
      }
      setBackendStatus('online');
      setDigest(previous => ({ ...previous, scannedCount: previous.scannedCount + scanned, matchedCount: previous.matchedCount + matched, sourcesMonitored: sources.length, generatedAt: locale === 'ar' ? 'الآن' : 'Just now' }));
    } catch (error) {
      setBackendStatus('offline');
      console.warn('[Radar] Scan failed', error);
    } finally { setIsScanning(false); }
    return { scanned, matched };
  };

  const resetToDemo = () => { if (isDemoMode) { setSources(INITIAL_SOURCES); setRules(INITIAL_RULES); setMatches(INITIAL_MATCHES); } };
  const connectFacebookSession = async () => {
    if (!DeviceSessionConnector.isNativeAvailable()) throw new Error('Authenticated Facebook monitoring requires the Android app.');
    const connected = await DeviceSessionConnector.connectFacebook();
    await refreshDeviceSession().catch(() => false);
    if (!connected) throw new Error('Facebook login is not complete yet.');
    const backendBaseUrl = getApiBaseUrl();
    if (backendBaseUrl) {
      await Promise.allSettled(sources.filter(source => source.connectorType === 'device_session' && source.platform === 'facebook' && !source.isPaused)
        .map(source => DeviceSessionConnector.scheduleBackgroundSource(source, backendBaseUrl, locale)));
    }
  };
  const disconnectFacebookSession = async () => {
    await Promise.allSettled(sources.filter(source => source.connectorType === 'device_session' && source.platform === 'facebook')
      .map(source => DeviceSessionConnector.cancelBackgroundSource(source.id)));
    await DeviceSessionConnector.disconnectFacebook();
    await refreshDeviceSession();
  };

  return (
    <RadarContext.Provider value={{
      user, sources, rules, matches, collections, digest, locale, theme, isScanning, backendStatus, isPostgres, aiConfigured, monitoringMode,
      deviceSessionAvailable, apifyConfigured: optionalPublicProviderConfigured, geminiConfigured: aiConfigured, isDemoMode, toggleDemoMode,
      selectedAlert, selectedAlertDetail: selectedAlert, selectedSourceId, isAddSourceOpen, isPaywallOpen, isDigestOpen, currentScreen,
      sharedIncomingUrl, initialAddUrl: sharedIncomingUrl, setLocale: setLocaleState, setTheme: setThemeState, setCurrentScreen,
      openAddSource, closeAddSource, openAlertDetail: setSelectedAlert, closeAlertDetail: () => setSelectedAlert(null),
      openPaywall: () => setIsPaywallOpen(true), closePaywall: () => setIsPaywallOpen(false), openDigest: () => setIsDigestOpen(true), closeDigest: () => setIsDigestOpen(false),
      addSourceWithRule, toggleSourcePause, deleteSource, addRule, toggleRule, deleteRule, updateRule, rateMatchFeedback, toggleSaveMatch, markMatchRead,
      scanAllSources, resetToDemo, refreshDeviceSession, connectFacebookSession, disconnectFacebookSession
    }}>
      {children}
    </RadarContext.Provider>
  );
};

export const useRadar = () => {
  const context = useContext(RadarContext);
  if (!context) throw new Error('useRadar must be used within a RadarProvider');
  return context;
};
