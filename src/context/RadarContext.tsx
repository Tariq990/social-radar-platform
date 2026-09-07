import React, { createContext, useContext, useState, useEffect } from 'react';
import { Source, WatchRule, AlertMatch, Collection, RadarDigest, UserProfile, NormalizedPost } from '../types';
import { 
  INITIAL_USER, 
  INITIAL_SOURCES, 
  INITIAL_RULES, 
  INITIAL_MATCHES, 
  INITIAL_COLLECTIONS, 
  INITIAL_DIGEST 
} from '../data/seedData';
import { defaultConnectorManager } from '../connectors/connectorManager';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { Locale } from '../lib/i18n';
import { apiCheckHealth, apiScanSources, apiGenerateDigest, normalizeAlertMatch } from '../services/api';

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
  geminiConfigured: boolean;
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
  toggleSourcePause: (sourceId: string) => void;
  deleteSource: (sourceId: string) => void;
  addRule: (rule: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => void;
  toggleRule: (ruleId: string) => void;
  deleteRule: (ruleId: string) => void;
  updateRule: (rule: WatchRule) => void;
  rateMatchFeedback: (matchId: string, feedback: 'relevant' | 'not_relevant') => void;
  toggleSaveMatch: (matchId: string) => void;
  markMatchRead: (matchId: string) => void;
  scanAllSources: () => Promise<{ scanned: number; matched: number }>;
  resetToDemo: () => void;
  connectFacebookSession: (accountName: string) => void;
  disconnectFacebookSession: () => void;
}

const RadarContext = createContext<RadarContextType | undefined>(undefined);

const STORAGE_KEYS = {
  SOURCES: 'mrscrap_sources_v1',
  RULES: 'mrscrap_rules_v1',
  MATCHES: 'mrscrap_matches_v1',
  USER: 'mrscrap_user_v1',
  LOCALE: 'mrscrap_locale_v1',
  THEME: 'mrscrap_theme_v1'
};

export const RadarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem(STORAGE_KEYS.LOCALE) as Locale) || 'en';
  });

  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem(STORAGE_KEYS.THEME) as 'dark' | 'light') || 'dark';
  });

  const [user, setUser] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.USER);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Error loading user from localStorage', e);
    }
    return INITIAL_USER;
  });

  const [sources, setSources] = useState<Source[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SOURCES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Error loading sources from localStorage', e);
    }
    return INITIAL_SOURCES;
  });

  const [rules, setRules] = useState<WatchRule[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RULES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Error loading rules from localStorage', e);
    }
    return INITIAL_RULES;
  });

  const [matches, setMatches] = useState<AlertMatch[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MATCHES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizeAlertMatch);
        }
      }
    } catch (e) {
      console.warn('Error loading matches from localStorage', e);
    }
    return INITIAL_MATCHES;
  });

  const [collections] = useState<Collection[]>(INITIAL_COLLECTIONS);
  const [digest, setDigest] = useState<RadarDigest>(INITIAL_DIGEST);

  const [isScanning, setIsScanning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertMatch | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
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
    // Default to 'landing' website page before entering the dashboard
    return 'landing';
  });
  const [sharedIncomingUrl, setSharedIncomingUrl] = useState<string | null>(null);

  // Check backend health on mount
  useEffect(() => {
    let isMounted = true;
    apiCheckHealth()
      .then(res => {
        if (isMounted) {
          setBackendStatus(res.status === 'ok' ? 'online' : 'offline');
          setGeminiConfigured(Boolean(res.geminiConfigured));
        }
      })
      .catch(() => {
        if (isMounted) {
          setBackendStatus('offline');
        }
      });
    return () => { isMounted = false; };
  }, []);

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

  // Persist state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
  }, [sources]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(rules));
  }, [rules]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(matches));
  }, [matches]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  }, [user]);

  // Android Share Target / URL parameters detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get('url') || params.get('text') || params.get('share_url');
    if (sharedUrl && (sharedUrl.includes('http') || sharedUrl.includes('facebook') || sharedUrl.includes('instagram'))) {
      setSharedIncomingUrl(sharedUrl);
      setIsAddSourceOpen(true);
      // Clean query params so refresh doesn't keep reopening
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
    const newSourceId = `src_${Date.now()}`;
    const newSource: Source = {
      ...sourceData,
      id: newSourceId,
      userId: user.id,
      activeRulesCount: 1,
      lastCheckedAt: 'Just now',
      isPaused: false,
      recentPostsCount: 8
    };

    const newRuleId = `rule_${Date.now()}`;
    const newRule: WatchRule = {
      id: newRuleId,
      userId: user.id,
      name: ruleName || `${newSource.displayName} Watch`,
      naturalLanguage: ruleNL,
      sourceIds: [newSourceId],
      collectionId: newSource.collectionId,
      minConfidence: 0.82,
      alertMode: 'instant',
      enabled: true,
      createdAt: new Date().toISOString()
    };

    setSources(prev => [newSource, ...prev]);
    setRules(prev => [newRule, ...prev]);
    setUser(prev => ({
      ...prev,
      watchedSourcesCount: prev.watchedSourcesCount + 1,
      activeRulesCount: prev.activeRulesCount + 1
    }));

    // Trigger instant evaluation on any sample posts from connector
    try {
      const response = await fetch('/api/ai/preview-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleNaturalLanguage: ruleNL,
          sourceName: newSource.displayName
        })
      });
      if (response.ok) {
        const preview = await response.json();
        const simulatedMatch: AlertMatch = {
          id: `match_${Date.now()}`,
          userId: user.id,
          postId: `post_${Date.now()}`,
          ruleId: newRuleId,
          ruleName: newRule.name,
          sourceId: newSourceId,
          sourceName: newSource.displayName,
          sourceAvatar: newSource.avatarUrl,
          sourcePlatform: newSource.platform,
          post: {
            id: `post_${Date.now()}`,
            sourceId: newSourceId,
            platform: newSource.platform,
            originalUrl: newSource.url,
            authorName: newSource.displayName,
            authorAvatar: newSource.avatarUrl,
            text: preview.excerpt || 'New verified matching post from source.',
            media: [
              {
                type: 'image',
                url: 'https://images.unsplash.com/photo-1555353540-64580b51c258?w=800&auto=format&fit=crop&q=80'
              }
            ],
            publishedAt: 'Just now',
            detectedAt: 'Just now',
            fingerprint: `fp_${Date.now()}`,
            metadata: { simulation: true }
          },
          confidence: 0.93,
          category: preview.category || 'Target Match',
          reason: preview.whyMatched || `Matched rule: "${ruleNL}"`,
          feedback: 'unrated',
          isRead: false,
          isSaved: false,
          createdAt: 'Just now'
        };
        setMatches(prev => [simulatedMatch, ...prev]);
      }
    } catch {
      // Ignored
    }
  };

  const toggleSourcePause = (sourceId: string) => {
    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, isPaused: !s.isPaused } : s));
  };

  const deleteSource = (sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
    setRules(prev => prev.filter(r => !r.sourceIds.includes(sourceId)));
    setMatches(prev => prev.filter(m => m.sourceId !== sourceId));
    setUser(prev => ({
      ...prev,
      watchedSourcesCount: Math.max(0, prev.watchedSourcesCount - 1)
    }));
  };

  const addRule = (ruleData: Omit<WatchRule, 'id' | 'userId' | 'createdAt'>) => {
    const newRule: WatchRule = {
      ...ruleData,
      id: `rule_${Date.now()}`,
      userId: user.id,
      createdAt: new Date().toISOString()
    };
    setRules(prev => [newRule, ...prev]);
    setUser(prev => ({ ...prev, activeRulesCount: prev.activeRulesCount + 1 }));
  };

  const toggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
  };

  const deleteRule = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
    setUser(prev => ({ ...prev, activeRulesCount: Math.max(0, prev.activeRulesCount - 1) }));
  };

  const updateRule = (updated: WatchRule) => {
    setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const rateMatchFeedback = (matchId: string, feedback: 'relevant' | 'not_relevant') => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, feedback } : m));
    if (selectedAlert && selectedAlert.id === matchId) {
      setSelectedAlert(prev => prev ? { ...prev, feedback } : null);
    }
  };

  const toggleSaveMatch = (matchId: string) => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, isSaved: !m.isSaved } : m));
    if (selectedAlert && selectedAlert.id === matchId) {
      setSelectedAlert(prev => prev ? { ...prev, isSaved: !prev.isSaved } : null);
    }
  };

  const markMatchRead = (matchId: string) => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, isRead: true } : m));
  };

  const scanAllSources = async (): Promise<{ scanned: number; matched: number }> => {
    setIsScanning(true);
    let totalScanned = 0;
    let newMatchesCount = 0;

    try {
      // First attempt backend scan via Express + Gemini API
      try {
        const scanRes = await apiScanSources(sources, rules, locale);
        totalScanned = scanRes.scanned;
        if (scanRes.matches && scanRes.matches.length > 0) {
          newMatchesCount = scanRes.matches.length;
          setMatches(prev => [...scanRes.matches, ...prev]);
        }
        setBackendStatus('online');
      } catch (backendErr) {
        console.warn('Backend scan failed, falling back to client simulation:', backendErr);
        setBackendStatus('offline');
        // Fallback local scan
        for (const source of sources.filter(s => !s.isPaused)) {
          totalScanned += Math.floor(Math.random() * 6) + 3;
          const sourceRules = rules.filter(r => r.enabled && r.sourceIds.includes(source.id));
          if (sourceRules.length > 0) {
            await defaultConnectorManager.testHealth(source);
          }
        }
      }

      // Update digest count
      setDigest(prev => ({
        ...prev,
        scannedCount: prev.scannedCount + totalScanned,
        generatedAt: locale === 'ar' ? 'الآن' : 'Just now'
      }));

      // Update source lastCheckedAt
      setSources(prev => prev.map(s => ({ ...s, lastCheckedAt: locale === 'ar' ? 'الآن' : 'Just now' })));
    } finally {
      setIsScanning(false);
    }

    return { scanned: totalScanned, matched: newMatchesCount };
  };

  const resetToDemo = () => {
    setSources(INITIAL_SOURCES);
    setRules(INITIAL_RULES);
    setMatches(INITIAL_MATCHES);
    setUser(INITIAL_USER);
    setDigest(INITIAL_DIGEST);
    localStorage.removeItem(STORAGE_KEYS.SOURCES);
    localStorage.removeItem(STORAGE_KEYS.RULES);
    localStorage.removeItem(STORAGE_KEYS.MATCHES);
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
    // Update authenticated sources status to needs_relogin
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
        geminiConfigured,
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
