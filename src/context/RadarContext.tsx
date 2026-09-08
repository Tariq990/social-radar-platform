import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Source, WatchRule, AlertMatch, Collection, RadarDigest, UserProfile } from '../types';
import {
  INITIAL_USER,
  INITIAL_SOURCES,
  INITIAL_RULES,
  INITIAL_MATCHES,
  INITIAL_COLLECTIONS,
  INITIAL_DIGEST
} from '../data/seedData';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { Locale } from '../lib/i18n';
import {
  apiCheckHealth,
  apiGetConfig,
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
  // Legacy aliases kept temporarily so existing UI components do not break.
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

const STORAGE_KEYS = {
  LOCALE: 'mrscrap_locale_v2',
  THEME: 'mrscrap_theme_v2',
  DEMO_MODE: 'mrscrap_demo_mode_v2'
};

function extractSharedUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  return match[0].replace(/[),.;]+$/, '');
}

export const RadarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => (localStorage.getItem(STORAGE_KEYS.LOCALE) as Locale) || 'en');
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => (localStorage.getItem(STORAGE_KEYS.THEME) as 'dark' | 'light') || 'dark');
  const [isDemoMode, setIsDemoMode] = useState(() => localStorage.getItem(STORAGE_KEYS.DEMO_MODE) === 'true');

  const [user, setUser] = useState<UserProfile>(INITIAL_USER);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [matches, setMatches] = useState<AlertMatch[]>([]);
  const [collections] = useState<Collection[]>(INITIAL_COLLECTIONS);
  const [digest, setDigest] = useState<RadarDigest>(INITIAL_DIGEST);

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
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen');
    return screen && ['radar', 'watchlist', 'alerts', 'rules', 'settings', 'landing'].includes(screen)
      ? screen as any
      : 'landing';
  });
  const [sharedIncomingUrl, setSharedIncomingUrl] = useState<string | null>(null);

  const deviceConnector = useMemo(() => new DeviceSessionConnector(), []);

  const refreshDeviceSession = async (): Promise<boolean> => {
    const status = await DeviceSessionConnector.getLocalSession();
    setDeviceSessionAvailable(status.available);
    setUser(previous => ({
      ...previous,
      deviceSessionConnected: status.connected,
      deviceSessionAccount: status.connected ? 'Facebook session on this device' : undefined,
      deviceSessionLastChecked: status.lastCheckedAt || status.connectedAt || undefined
    }));
    return status.connected;
  };

  const loadDatabaseState = async () => {
    try {
      const [health, config, dbSources, dbRules, dbAlerts] = await Promise.all([
        apiCheckHealth(),
        apiGetConfig(),
        apiFetchSources(),
        apiFetchRules(),
        apiFetchAlerts()
      ]);

      setBackendStatus(health.status === 'ok' ? 'online' : 'offline');
      setIsPostgres(Boolean(config.isPostgres));
      setAiConfigured(Boolean(config.aiConfigured));
      setMonitoringMode(config.monitoringMode || 'device_session');
      setOptionalPublicProviderConfigured(Boolean(config.optionalPublicProviderConfigured));
      setSources(dbSources);
      setRules(dbRules);
      setMatches(dbAlerts);
      setUser(previous => ({
        ...previous,
        watchedSourcesCount: dbSources.length,
        activeRulesCount: dbRules.filter(rule => rule.enabled).length
      }));
    } catch (error) {
      console.warn('[RadarProvider] Backend state load failed', error);
      setBackendStatus('offline');
      if (isDemoMode) {
        setSources(INITIAL_SOURCES);
        setRules(INITIAL_RULES);
        setMatches(INITIAL_MATCHES);
      }
    }
  };

  useEffect(() => {
    loadDatabaseState();
    refreshDeviceSession().catch(() => {});
  }, [isDemoMode]);

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
    const sharedUrl = raw ? extractSharedUrl(raw) : null;
    if (sharedUrl) {
      setSharedIncomingUrl(sharedUrl);
      setIsAddSourceOpen(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const nativeShareHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const url = detail?.text ? extractSharedUrl(detail.text) : null;
      if (!url) return;
      setSharedIncomingUrl(url);
      setCurrentScreen('radar');
      setIsAddSourceOpen(true);
    };
    window.addEventListener('mrscrap:share', nativeShareHandler as EventListener);
    return () => window.removeEventListener('mrscrap:share', nativeShareHandler as EventListener);
  }, []);

  const toggleDemoMode = () => {
    const next = !isDemoMode;
    setIsDemoMode(next);
    localStorage.setItem(STORAGE_KEYS.DEMO_MODE, String(next));
  };

  const openAddSource = (url?: string) => {
    if (url) setSharedIncomingUrl(url);
    setIsAddSourceOpen(true);
  };
  const closeAddSource = () => {
    setIsAddSourceOpen(false);
    setSharedIncomingUrl(null);
  };

  const addSourceWithRule = async (
    sourceData: Omit<Source, 'id' | 'userId' | 'activeRulesCount' | 'lastCheckedAt' | 'isPaused'>,
    ruleNL: string,
    ruleName?: string
  ) => {
    const persistedSource = await apiCreateSource({
      platform: sourceData.platform,
      externalId: sourceData.externalId,
      url: sourceData.url,
      name: sourceData.displayName,
      handle: sourceData.handle,
      avatarUrl: sourceData.avatarUrl,
      bio: sourceData.bio,
      visibilityType: sourceData.visibilityType,
      connectorType: sourceData.connectorType
    });

    try {
      const persistedRule = await apiCreateRule({
        name: ruleName || `${persistedSource.displayName} Watch`,
        naturalLanguage: ruleNL,
        minConfidence: 0.82,
        alertMode: 'instant',
        collectionId: sourceData.collectionId
      }, [persistedSource.id]);

      setSources(previous => [persistedSource, ...previous.filter(source => source.id !== persistedSource.id)]);
      setRules(previous => [persistedRule, ...previous.filter(rule => rule.id !== persistedRule.id)]);
      setUser(previous => ({
        ...previous,
        watchedSourcesCount: previous.watchedSourcesCount + 1,
        activeRulesCount: previous.activeRulesCount + 1
      }));

      if (persistedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable()) {
        const backendBaseUrl = getApiBaseUrl();
        if (backendBaseUrl) {
          await DeviceSessionConnector.scheduleBackgroundSource(persistedSource, backendBaseUrl);
        }

        const connected = await refreshDeviceSession();
        if (connected) {
          try {
            const posts = await deviceConnector.fetchLatest(persistedSource);
            if (posts.length > 0) {
              const ingest = await apiIngestDevicePosts(persistedSource.id, posts, locale);
              if (ingest.matchesCreated.length > 0) {
                setMatches(previous => [...ingest.matchesCreated, ...previous]);
              }
            }
          } catch (error) {
            console.warn('[addSourceWithRule] Initial authenticated device collection did not complete', error);
          }
        }
      } else {
        apiScanSources(isDemoMode).then(scan => {
          if (scan.matches.length > 0) setMatches(previous => [...scan.matches, ...previous]);
        }).catch(() => {});
      }
    } catch (error) {
      // Avoid orphaned sources if rule creation fails.
      await apiDeleteSource(persistedSource.id).catch(() => {});
      throw error;
    }
  };

  const toggleSourcePause = async (sourceId: string) => {
    const source = sources.find(item => item.id === sourceId);
    const nextPaused = !source?.isPaused;
    setSources(previous => previous.map(item => item.id === sourceId ? { ...item, isPaused: nextPaused } : item));
    try {
      await apiToggleSourcePause(sourceId);
      if (source?.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable()) {
        if (nextPaused) await DeviceSessionConnector.cancelBackgroundSource(sourceId);
        else {
          const backendBaseUrl = getApiBaseUrl();
          if (backendBaseUrl) await DeviceSessionConnector.scheduleBackgroundSource(source, backendBaseUrl);
        }
      }
    } catch (error) {
      setSources(previous => previous.map(item => item.id === sourceId ? { ...item, isPaused: !nextPaused } : item));
      console.warn('Failed to toggle source pause', error);
    }
  };

  const deleteSource = async (sourceId: string) => {
    const snapshot = sources;
    setSources(previous => previous.filter(source => source.id !== sourceId));
    try {
      if (DeviceSessionConnector.isNativeAvailable()) await DeviceSessionConnector.cancelBackgroundSource(sourceId);
      await apiDeleteSource(sourceId);
      setRules(previous => previous.filter(rule => !rule.sourceIds.includes(sourceId)));
      setMatches(previous => previous.filter(match => match.sourceId !== sourceId));
      setUser(previous => ({ ...previous, watchedSourcesCount: Math.max(0, previous.watchedSourcesCount - 1) }));
    } catch (error) {
      setSources(snapshot);
      console.warn('Failed to delete source', error);
    }
  };

  const addRule = async (ruleData: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => {
    const persisted = await apiCreateRule(ruleData, ruleData.sourceIds || []);
    setRules(previous => [persisted, ...previous]);
    setUser(previous => ({ ...previous, activeRulesCount: previous.activeRulesCount + 1 }));
  };

  const toggleRule = async (ruleId: string) => {
    const previous = rules.find(rule => rule.id === ruleId)?.enabled;
    setRules(current => current.map(rule => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule));
    try {
      await apiToggleRule(ruleId);
    } catch (error) {
      setRules(current => current.map(rule => rule.id === ruleId ? { ...rule, enabled: Boolean(previous) } : rule));
      throw error;
    }
  };

  const deleteRule = async (ruleId: string) => {
    await apiDeleteRule(ruleId);
    setRules(previous => previous.filter(rule => rule.id !== ruleId));
    setUser(previous => ({ ...previous, activeRulesCount: Math.max(0, previous.activeRulesCount - 1) }));
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
      if (DeviceSessionConnector.isNativeAvailable()) {
        const connected = await refreshDeviceSession();
        if (connected) {
          for (const source of sources.filter(item => item.connectorType === 'device_session' && !item.isPaused)) {
            scanned++;
            try {
              const posts = await deviceConnector.fetchLatest(source);
              const ingest = await apiIngestDevicePosts(source.id, posts, locale);
              matched += ingest.matchesCreated.length;
              if (ingest.matchesCreated.length > 0) {
                setMatches(previous => [...ingest.matchesCreated, ...previous]);
              }
            } catch (error) {
              console.warn(`[Radar] Authenticated scan failed for ${source.id}`, error);
            }
          }
        }
      }

      const serverScan = await apiScanSources(isDemoMode);
      scanned = Math.max(scanned, serverScan.scanned);
      matched += serverScan.matches.length;
      if (serverScan.matches.length > 0) setMatches(previous => [...serverScan.matches, ...previous]);
      setBackendStatus('online');
      setDigest(previous => ({
        ...previous,
        scannedCount: previous.scannedCount + scanned,
        matchedCount: previous.matchedCount + matched,
        generatedAt: locale === 'ar' ? 'الآن' : 'Just now'
      }));
      setSources(previous => previous.map(source => ({ ...source, lastCheckedAt: locale === 'ar' ? 'الآن' : 'Just now' })));
    } catch (error) {
      setBackendStatus('offline');
      console.warn('[Radar] Scan failed', error);
    } finally {
      setIsScanning(false);
    }
    return { scanned, matched };
  };

  const resetToDemo = () => {
    setIsDemoMode(true);
    localStorage.setItem(STORAGE_KEYS.DEMO_MODE, 'true');
    setSources(INITIAL_SOURCES);
    setRules(INITIAL_RULES);
    setMatches(INITIAL_MATCHES);
    setUser(INITIAL_USER);
    setDigest(INITIAL_DIGEST);
  };

  const connectFacebookSession = async () => {
    if (!DeviceSessionConnector.isNativeAvailable()) {
      throw new Error('Authenticated Facebook monitoring requires the Android app.');
    }
    await DeviceSessionConnector.connectFacebook();

    // The dedicated login activity temporarily covers this activity. Poll after it closes;
    // timers resume and the local CookieManager session can then be confirmed without cookies
    // ever crossing the native bridge.
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (await refreshDeviceSession()) return;
    }
  };

  const disconnectFacebookSession = async () => {
    await DeviceSessionConnector.wipeLocalSession();
    await refreshDeviceSession();
    setSources(previous => previous.map(source => source.connectorType === 'device_session'
      ? { ...source, connectorStatus: 'needs_relogin' }
      : source));
  };

  return (
    <RadarContext.Provider value={{
      user,
      sources,
      rules,
      matches,
      collections,
      digest,
      locale,
      theme,
      isScanning,
      backendStatus,
      isPostgres,
      aiConfigured,
      monitoringMode,
      deviceSessionAvailable,
      apifyConfigured: optionalPublicProviderConfigured,
      geminiConfigured: aiConfigured,
      isDemoMode,
      toggleDemoMode,
      selectedAlert,
      selectedAlertDetail: selectedAlert,
      selectedSourceId,
      isAddSourceOpen,
      isPaywallOpen,
      isDigestOpen,
      currentScreen,
      sharedIncomingUrl,
      initialAddUrl: sharedIncomingUrl,
      setLocale: setLocaleState,
      setTheme: setThemeState,
      setCurrentScreen,
      openAddSource,
      closeAddSource,
      openAlertDetail: setSelectedAlert,
      closeAlertDetail: () => setSelectedAlert(null),
      openPaywall: () => setIsPaywallOpen(true),
      closePaywall: () => setIsPaywallOpen(false),
      openDigest: () => setIsDigestOpen(true),
      closeDigest: () => setIsDigestOpen(false),
      addSourceWithRule,
      toggleSourcePause,
      deleteSource,
      addRule,
      toggleRule,
      deleteRule,
      updateRule,
      rateMatchFeedback,
      toggleSaveMatch,
      markMatchRead,
      scanAllSources,
      resetToDemo,
      refreshDeviceSession,
      connectFacebookSession,
      disconnectFacebookSession
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
