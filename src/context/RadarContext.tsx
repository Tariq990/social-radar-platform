import React, { createContext, useContext, useState, useEffect } from 'react';
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
  apiGenerateDigest, 
  normalizeAlertMatch 
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
  // Actions
  setLocale: (loc: Locale) => void;
  setTheme: (thm: 'dark' | 'light') => void;
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
  connectFacebookSession: (accountName: string) => void;
  disconnectFacebookSession: () => void;
}

const RadarContext = createContext<RadarContextType | undefined>(undefined);

const STORAGE_KEYS = {
  LOCALE: 'mrscrap_locale_v2',
  THEME: 'mrscrap_theme_v2',
  DEMO_MODE: 'mrscrap_demo_mode_v2'
};

export const RadarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem(STORAGE_KEYS.LOCALE) as Locale) || 'en';
  });

  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem(STORAGE_KEYS.THEME) as 'dark' | 'light') || 'dark';
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.DEMO_MODE) === 'true';
  });

  const [user, setUser] = useState<UserProfile>(INITIAL_USER);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [matches, setMatches] = useState<AlertMatch[]>([]);
  const [collections] = useState<Collection[]>(INITIAL_COLLECTIONS);
  const [digest, setDigest] = useState<RadarDigest>(INITIAL_DIGEST);

  const [isScanning, setIsScanning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [isPostgres, setIsPostgres] = useState(false);
  const [apifyConfigured, setApifyConfigured] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);

  const [selectedAlert, setSelectedAlert] = useState<AlertMatch | null>(null);
  const [selectedSourceId] = useState<string | null>(null);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isDigestOpen, setIsDigestOpen] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<'radar' | 'watchlist' | 'alerts' | 'rules' | 'settings' | 'landing'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const scr = params.get('screen');
      if (scr && ['radar', 'watchlist', 'alerts', 'rules', 'settings', 'landing'].includes(scr)) {
        return scr as any;
      }
    }
    return 'landing';
  });
  const [sharedIncomingUrl, setSharedIncomingUrl] = useState<string | null>(null);

  // Sync data from the persistent backend database
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
      setApifyConfigured(Boolean(config.apifyConfigured));
      setGeminiConfigured(Boolean(config.geminiConfigured));

      if (dbSources.length > 0 || dbRules.length > 0 || dbAlerts.length > 0) {
        setSources(dbSources);
        setRules(dbRules);
        setMatches(dbAlerts);
        setUser(prev => ({
          ...prev,
          watchedSourcesCount: dbSources.length,
          activeRulesCount: dbRules.filter(r => r.enabled).length
        }));
      } else {
        // If DB is freshly created and user wants demo mode, show initial demo setup
        if (isDemoMode) {
          setSources(INITIAL_SOURCES);
          setRules(INITIAL_RULES);
          setMatches(INITIAL_MATCHES);
        }
      }
    } catch (err) {
      console.warn('[RadarProvider] Could not load state from backend database, offline:', err);
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
  }, [isDemoMode]);

  // Sync RTL and document attributes on locale/theme change
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem(STORAGE_KEYS.LOCALE, locale);
  }, [locale]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      const meta = document.getElementById('theme-color-meta');
      if (meta) meta.setAttribute('content', '#020617');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      const meta = document.getElementById('theme-color-meta');
      if (meta) meta.setAttribute('content', '#f8fafc');
    }
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  const toggleDemoMode = () => {
    const next = !isDemoMode;
    setIsDemoMode(next);
    localStorage.setItem(STORAGE_KEYS.DEMO_MODE, String(next));
  };

  // Android Share Target / URL parameters detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get('url') || params.get('text') || params.get('share_url');
    if (sharedUrl && (sharedUrl.includes('http') || sharedUrl.includes('facebook') || sharedUrl.includes('instagram'))) {
      setSharedIncomingUrl(sharedUrl);
      setIsAddSourceOpen(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
  };

  const setTheme = (newTheme: 'dark' | 'light') => {
    setThemeState(newTheme);
  };

  const openAddSource = (url?: string) => {
    if (url) setSharedIncomingUrl(url);
    setIsAddSourceOpen(true);
  };

  const closeAddSource = () => {
    setIsAddSourceOpen(false);
    setSharedIncomingUrl(null);
  };

  const openAlertDetail = (alert: AlertMatch) => {
    setSelectedAlert(alert);
  };

  const closeAlertDetail = () => {
    setSelectedAlert(null);
  };

  const openPaywall = () => setIsPaywallOpen(true);
  const closePaywall = () => setIsPaywallOpen(false);
  const openDigest = () => setIsDigestOpen(true);
  const closeDigest = () => setIsDigestOpen(false);

  const addSourceWithRule = async (
    sourceData: Omit<Source, 'id' | 'userId' | 'activeRulesCount' | 'lastCheckedAt' | 'isPaused'>,
    ruleNL: string,
    ruleName?: string
  ) => {
    try {
      // Persist source to backend database
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

      // Persist rule to backend database
      const persistedRule = await apiCreateRule({
        name: ruleName || `${persistedSource.displayName} Watch`,
        naturalLanguage: ruleNL,
        minConfidence: 0.82,
        alertMode: 'instant',
        collectionId: sourceData.collectionId
      }, [persistedSource.id]);

      setSources(prev => [persistedSource, ...prev.filter(s => s.id !== persistedSource.id)]);
      setRules(prev => [persistedRule, ...prev.filter(r => r.id !== persistedRule.id)]);
      setUser(prev => ({
        ...prev,
        watchedSourcesCount: prev.watchedSourcesCount + 1,
        activeRulesCount: prev.activeRulesCount + 1
      }));

      // Trigger instant scan in the background to fetch first batch of posts
      apiScanSources(isDemoMode).then(scanRes => {
        if (scanRes.matches && scanRes.matches.length > 0) {
          setMatches(prev => [...scanRes.matches, ...prev]);
        }
      }).catch(() => {});
    } catch (err: any) {
      console.error('[addSourceWithRule] Error saving to database:', err);
      throw err;
    }
  };

  const toggleSourcePause = async (sourceId: string) => {
    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, isPaused: !s.isPaused } : s));
    try {
      await apiToggleSourcePause(sourceId);
    } catch (err) {
      console.warn('Failed to toggle source pause on server', err);
    }
  };

  const deleteSource = async (sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
    setRules(prev => prev.filter(r => !r.sourceIds.includes(sourceId)));
    setMatches(prev => prev.filter(m => m.sourceId !== sourceId));
    setUser(prev => ({
      ...prev,
      watchedSourcesCount: Math.max(0, prev.watchedSourcesCount - 1)
    }));
    try {
      await apiDeleteSource(sourceId);
    } catch (err) {
      console.warn('Failed to delete source on server', err);
    }
  };

  const addRule = async (ruleData: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => {
    try {
      const persisted = await apiCreateRule(ruleData, ruleData.sourceIds || []);
      setRules(prev => [persisted, ...prev]);
      setUser(prev => ({ ...prev, activeRulesCount: prev.activeRulesCount + 1 }));
    } catch (err) {
      console.error('Failed to create rule on server', err);
    }
  };

  const toggleRule = async (ruleId: string) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
    try {
      await apiToggleRule(ruleId);
    } catch (err) {
      console.warn('Failed to toggle rule on server', err);
    }
  };

  const deleteRule = async (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
    setUser(prev => ({ ...prev, activeRulesCount: Math.max(0, prev.activeRulesCount - 1) }));
    try {
      await apiDeleteRule(ruleId);
    } catch (err) {
      console.warn('Failed to delete rule on server', err);
    }
  };

  const updateRule = (updated: WatchRule) => {
    setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const rateMatchFeedback = async (matchId: string, feedback: 'relevant' | 'not_relevant') => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, feedback } : m));
    if (selectedAlert && selectedAlert.id === matchId) {
      setSelectedAlert(prev => prev ? { ...prev, feedback } : null);
    }
    try {
      await apiUpdateAlert(matchId, { feedback });
    } catch (err) {
      console.warn('Failed to update alert feedback on server', err);
    }
  };

  const toggleSaveMatch = async (matchId: string) => {
    let nextSaved = false;
    setMatches(prev => prev.map(m => {
      if (m.id === matchId) {
        nextSaved = !m.isSaved;
        return { ...m, isSaved: nextSaved };
      }
      return m;
    }));
    if (selectedAlert && selectedAlert.id === matchId) {
      setSelectedAlert(prev => prev ? { ...prev, isSaved: !prev.isSaved } : null);
    }
    try {
      await apiUpdateAlert(matchId, { isSaved: nextSaved });
    } catch (err) {
      console.warn('Failed to update save status on server', err);
    }
  };

  const markMatchRead = async (matchId: string) => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, isRead: true } : m));
    try {
      await apiUpdateAlert(matchId, { isRead: true });
    } catch (err) {
      console.warn('Failed to mark alert as read on server', err);
    }
  };

  const scanAllSources = async (): Promise<{ scanned: number; matched: number }> => {
    setIsScanning(true);
    let totalScanned = 0;
    let newMatchesCount = 0;

    try {
      const scanRes = await apiScanSources(isDemoMode);
      totalScanned = scanRes.scanned;

      if (scanRes.matches && scanRes.matches.length > 0) {
        newMatchesCount = scanRes.matches.length;
        setMatches(prev => [...scanRes.matches, ...prev]);
      }

      setBackendStatus('online');

      // Update digest count
      setDigest(prev => ({
        ...prev,
        scannedCount: prev.scannedCount + totalScanned,
        generatedAt: locale === 'ar' ? 'الآن' : 'Just now'
      }));

      // Update source lastCheckedAt
      setSources(prev => prev.map(s => ({ ...s, lastCheckedAt: locale === 'ar' ? 'الآن' : 'Just now' })));
    } catch (backendErr) {
      console.warn('Backend scan failed:', backendErr);
      setBackendStatus('offline');
    } finally {
      setIsScanning(false);
    }

    return { scanned: totalScanned, matched: newMatchesCount };
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

  const connectFacebookSession = (accountName: string) => {
    DeviceSessionConnector.saveLocalSession(accountName);
    setUser(prev => ({
      ...prev,
      deviceSessionConnected: true,
      deviceSessionAccount: accountName,
      deviceSessionLastChecked: 'Just now'
    }));
  };

  const disconnectFacebookSession = () => {
    DeviceSessionConnector.wipeLocalSession();
    setUser(prev => ({
      ...prev,
      deviceSessionConnected: false,
      deviceSessionAccount: undefined
    }));
    setSources(prev => prev.map(s => s.connectorType === 'device_session' ? { ...s, connectorStatus: 'needs_relogin' } : s));
  };

  return (
    <RadarContext.Provider
      value={{
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
        apifyConfigured,
        geminiConfigured,
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
        setLocale,
        setTheme,
        setCurrentScreen,
        openAddSource,
        closeAddSource,
        openAlertDetail,
        closeAlertDetail,
        openPaywall,
        closePaywall,
        openDigest,
        closeDigest,
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
        connectFacebookSession,
        disconnectFacebookSession
      }}
    >
      {children}
    </RadarContext.Provider>
  );
};

export const useRadar = () => {
  const context = useContext(RadarContext);
  if (!context) {
    throw new Error('useRadar must be used within a RadarProvider');
  }
  return context;
};
