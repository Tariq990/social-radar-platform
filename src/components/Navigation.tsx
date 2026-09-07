import React from 'react';
import { 
  Radar, 
  Eye, 
  Bell, 
  SlidersHorizontal, 
  Settings, 
  Bookmark, 
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Home,
  Server
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

interface NavigationProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ collapsed, onToggleCollapse }) => {
  const { currentScreen, setCurrentScreen, locale, matches, sources, rules, backendStatus } = useRadar();
  const t = translations[locale];

  const unreadAlerts = matches.filter(m => !m.isRead).length;
  const activeSources = sources.filter(s => !s.isPaused).length;

  interface NavItem {
    id: 'radar' | 'watchlist' | 'alerts' | 'rules' | 'settings';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }

  const navItems: NavItem[] = [
    {
      id: 'radar',
      label: t.navRadar,
      icon: Radar,
      badge: unreadAlerts > 0 ? unreadAlerts : undefined
    },
    {
      id: 'watchlist',
      label: t.navWatchlist,
      icon: Eye,
      badge: activeSources > 0 ? activeSources : undefined
    },
    {
      id: 'alerts',
      label: t.navAlerts,
      icon: Bell,
      badge: unreadAlerts > 0 ? unreadAlerts : undefined
    },
    {
      id: 'rules',
      label: t.navRules,
      icon: SlidersHorizontal,
      badge: rules.length > 0 ? rules.length : undefined
    },
    {
      id: 'settings',
      label: t.navProfile,
      icon: Settings,
      badge: undefined
    }
  ];

  return (
    <>
      {/* Desktop Left Sidebar */}
      <aside 
        className={`hidden lg:flex flex-col border-r border-slate-800/80 bg-slate-950/95 transition-all duration-300 z-20 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center px-4 border-b border-slate-800/80 justify-between">
          <div 
            onClick={() => setCurrentScreen('radar')}
            className="flex items-center gap-3 cursor-pointer overflow-hidden"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex-shrink-0 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-cyan-500/20">
              <Radar className="w-5 h-5 text-white" />
            </div>
            {!collapsed && (
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-100 tracking-tight">{BRAND.name}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 font-medium">
                    {locale === 'ar' ? BRAND.categoryAr : BRAND.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {locale === 'ar' ? BRAND.taglineAr : BRAND.tagline}
                </p>
              </div>
            )}
          </div>

          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              locale === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            ) : (
              locale === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentScreen === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => setCurrentScreen(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                {!collapsed && <span className="flex-1 text-start truncate">{item.label}</span>}
                {!collapsed && item.badge !== undefined && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {item.badge}
                  </span>
                )}
                {collapsed && item.badge !== undefined && (
                  <span className="w-2 h-2 rounded-full bg-cyan-400 absolute top-2 end-2" />
                )}
              </button>
            );
          })}

          {/* Website Home Link */}
          <button
            id="nav-item-landing"
            onClick={() => setCurrentScreen('landing')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mt-3 border cursor-pointer ${
              currentScreen === 'landing'
                ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-slate-800/40'
            }`}
            title={collapsed ? (locale === 'ar' ? 'صفحة الموقع الرئيسية' : 'Website Homepage') : undefined}
          >
            <Home className="w-5 h-5 flex-shrink-0 text-cyan-400" />
            {!collapsed && (
              <span className="flex-1 text-start truncate font-semibold text-xs">
                {locale === 'ar' ? 'صفحة الموقع الرئيسية' : 'Website Homepage'}
              </span>
            )}
          </button>
        </div>

        {/* Sidebar Footer: App & Backend status */}
        {!collapsed && (
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-xs text-slate-500 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Backend API</span>
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {backendStatus === 'online' ? 'Express Online' : 'Connected'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span>{BRAND.appVersion}</span>
              <span className="text-cyan-400 font-medium">Gemini 3.8</span>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Bottom Navigation (Strict 5 items maximum) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-800/80 backdrop-blur-lg pb-safe">
        <div className="grid grid-cols-5 h-16 max-w-md mx-auto px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentScreen === item.id;
            return (
              <button
                key={item.id}
                id={`mobile-nav-${item.id}`}
                onClick={() => setCurrentScreen(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 py-1 transition-colors ${
                  isActive ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium tracking-tight truncate max-w-[56px]">
                  {item.label}
                </span>
                {isActive && (
                  <span className="absolute bottom-1 w-6 h-0.5 rounded-full bg-cyan-400" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
