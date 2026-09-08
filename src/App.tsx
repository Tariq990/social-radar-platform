import React, { useState, useEffect } from 'react';
import { RadarProvider, useRadar } from './context/RadarContext';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { RadarHomeScreen } from './screens/RadarHomeScreen';
import { WatchlistScreen } from './screens/WatchlistScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { RulesScreen } from './screens/RulesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LandingScreen } from './screens/LandingScreen';
import { AuthScreen } from './screens/AuthScreen';
import { AddSourceModal } from './components/AddSourceModal';
import { AlertDetailModal } from './components/AlertDetailModal';
import { DigestModal } from './components/DigestModal';
import { PaywallModal } from './components/PaywallModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ForceUpdateGate } from './components/ForceUpdateGate';
import { apiGetAuthSession } from './services/api';
import { extractSupportedSocialUrl } from './lib/socialUrl';

const RadarAppContent: React.FC = () => {
  const {
    currentScreen,
    setCurrentScreen,
    isAddSourceOpen,
    closeAddSource,
    sharedIncomingUrl,
    selectedAlert,
    closeAlertDetail,
    openAddSource,
    theme,
    locale
  } = useRadar();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');

  useEffect(() => {
    let cancelled = false;
    apiGetAuthSession()
      .then(session => {
        if (!cancelled) setAuthState(session.authenticated && session.user ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!cancelled) setAuthState('anonymous');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      let rawShare = params.get('url') || params.get('text') || params.get('share_url') || '';
      if (!rawShare) {
        const pending = sessionStorage.getItem('mrscrap_pending_share');
        if (pending) {
          try {
            const parsed = JSON.parse(pending);
            rawShare = typeof parsed?.text === 'string' ? parsed.text : '';
          } catch { /* ignore malformed pending native share */ }
          sessionStorage.removeItem('mrscrap_pending_share');
        }
      }
      const sharedUrl = extractSupportedSocialUrl(rawShare);
      if (sharedUrl) openAddSource(sharedUrl);
    } catch {
      // Ignore malformed share parameters. Unsupported URLs never open the source flow.
    }
  }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('mrscrap_pending_screen');
      if (pending === 'alerts' || pending === 'radar' || pending === 'watchlist') {
        setCurrentScreen(pending);
        sessionStorage.removeItem('mrscrap_pending_screen');
      }
    } catch { /* sessionStorage may be unavailable on hardened WebViews */ }

    const navigate = (event: Event) => {
      const screen = (event as CustomEvent<{ screen?: string }>).detail?.screen;
      if (screen === 'alerts' || screen === 'radar' || screen === 'watchlist') {
        setCurrentScreen(screen);
        try { sessionStorage.removeItem('mrscrap_pending_screen'); } catch { }
      }
    };
    window.addEventListener('mrscrap:navigate', navigate as EventListener);
    return () => window.removeEventListener('mrscrap:navigate', navigate as EventListener);
  }, [setCurrentScreen]);

  const completeAuthentication = () => {
    const params = new URLSearchParams();
    params.set('screen', currentScreen === 'alerts' || currentScreen === 'watchlist' ? currentScreen : 'radar');
    if (sharedIncomingUrl) params.set('url', sharedIncomingUrl);
    window.location.replace(`/?${params.toString()}`);
  };

  const loadingAuth = (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
      <div className="flex items-center gap-3 text-xs font-semibold">
        <span className="w-4 h-4 rounded-full border-2 border-cyan-500 border-r-transparent animate-spin" />
        {locale === 'ar' ? 'جاري التحقق من الجلسة...' : 'Checking your session...'}
      </div>
    </div>
  );

  if (currentScreen === 'landing') {
    return (
      <div className={`min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 transition-colors duration-200 ${theme}`}>
        <ErrorBoundary>
          <LandingScreen />
        </ErrorBoundary>

        {isAddSourceOpen && authState === 'authenticated' && (
          <AddSourceModal
            initialUrl={sharedIncomingUrl || undefined}
            onClose={closeAddSource}
          />
        )}

        {isAddSourceOpen && authState === 'checking' && (
          <div className="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-sm">{loadingAuth}</div>
        )}

        {isAddSourceOpen && authState === 'anonymous' && (
          <AuthScreen locale={locale} onSuccess={completeAuthentication} onCancel={closeAddSource} modal />
        )}

        <PaywallModal />
      </div>
    );
  }

  if (authState === 'checking') return loadingAuth;

  if (authState === 'anonymous') {
    return (
      <AuthScreen
        locale={locale}
        onSuccess={completeAuthentication}
        onCancel={() => setCurrentScreen('landing')}
      />
    );
  }

  const renderDashboardScreen = () => {
    switch (currentScreen) {
      case 'watchlist':
        return <WatchlistScreen />;
      case 'alerts':
        return <AlertsScreen />;
      case 'rules':
        return <RulesScreen />;
      case 'settings':
        return <SettingsScreen />;
      case 'radar':
      default:
        return <RadarHomeScreen />;
    }
  };

  return (
    <div className={`min-h-screen flex bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 transition-colors duration-200 ${theme}`}>
      <Navigation
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <Header />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-6 max-w-7xl w-full mx-auto">
          <ErrorBoundary>
            {renderDashboardScreen()}
          </ErrorBoundary>
        </main>
      </div>

      {isAddSourceOpen && (
        <AddSourceModal
          initialUrl={sharedIncomingUrl || undefined}
          onClose={closeAddSource}
        />
      )}

      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          onClose={closeAlertDetail}
        />
      )}

      <DigestModal />
      <PaywallModal />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ForceUpdateGate>
        <RadarProvider>
          <RadarAppContent />
        </RadarProvider>
      </ForceUpdateGate>
    </ErrorBoundary>
  );
}
