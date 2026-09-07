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
import { AddSourceModal } from './components/AddSourceModal';
import { AlertDetailModal } from './components/AlertDetailModal';
import { DigestModal } from './components/DigestModal';
import { PaywallModal } from './components/PaywallModal';
import { ErrorBoundary } from './components/ErrorBoundary';

const RadarAppContent: React.FC = () => {
  const { 
    currentScreen, 
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

  // Check URL query parameters for Android Share Target (e.g. ?url=... or ?text=...)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedUrl = params.get('url') || params.get('text');
      if (sharedUrl && (sharedUrl.includes('facebook.com') || sharedUrl.includes('instagram.com') || sharedUrl.startsWith('http'))) {
        openAddSource(sharedUrl);
        // Clear search param to prevent re-opening on reload
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch {
      // Ignore
    }
  }, []);

  // If on landing screen, show full-page public website before the dashboard
  if (currentScreen === 'landing') {
    return (
      <div className={`min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 transition-colors duration-200 ${theme}`}>
        <ErrorBoundary>
          <LandingScreen />
        </ErrorBoundary>

        {/* Global Modals if triggered from landing page */}
        {isAddSourceOpen && (
          <AddSourceModal 
            initialUrl={sharedIncomingUrl || undefined} 
            onClose={closeAddSource} 
          />
        )}
        <PaywallModal />
      </div>
    );
  }

  // Render current dashboard screen safely with fallback
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
      {/* Desktop Sidebar */}
      <Navigation 
        collapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <Header />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-6 max-w-7xl w-full mx-auto">
          <ErrorBoundary>
            {renderDashboardScreen()}
          </ErrorBoundary>
        </main>
      </div>

      {/* Global Modals */}
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
      <RadarProvider>
        <RadarAppContent />
      </RadarProvider>
    </ErrorBoundary>
  );
}
