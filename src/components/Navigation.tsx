import React from 'react';
import { Radar, Eye, Bell, SlidersHorizontal, Settings, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

interface NavigationProps { collapsed: boolean; onToggleCollapse: () => void; }

export const Navigation: React.FC<NavigationProps> = ({ collapsed, onToggleCollapse }) => {
  const { currentScreen, setCurrentScreen, locale, matches, sources, rules, backendStatus } = useRadar();
  const t = translations[locale];
  const unreadAlerts = matches.filter(match => !match.isRead).length;
  const activeSources = sources.filter(source => !source.isPaused).length;
  const items = [
    { id: 'radar' as const, label: t.navRadar, icon: Radar, badge: unreadAlerts },
    { id: 'watchlist' as const, label: t.navWatchlist, icon: Eye, badge: activeSources },
    { id: 'alerts' as const, label: t.navAlerts, icon: Bell, badge: unreadAlerts },
    { id: 'rules' as const, label: t.navRules, icon: SlidersHorizontal, badge: rules.filter(rule => rule.enabled).length },
    { id: 'settings' as const, label: t.navProfile, icon: Settings, badge: 0 }
  ];
  const backendLabel = backendStatus === 'online'
    ? (locale === 'ar' ? 'متصل' : 'Online')
    : backendStatus === 'offline'
      ? (locale === 'ar' ? 'غير متصل' : 'Offline')
      : (locale === 'ar' ? 'جاري الاتصال' : 'Connecting');

  return (
    <>
      <aside className={`hidden lg:flex flex-col border-r border-slate-800/80 bg-slate-950/95 transition-all duration-300 z-20 ${collapsed ? 'w-20' : 'w-64'}`}>
        <div className="h-16 flex items-center px-4 border-b border-slate-800/80 justify-between">
          <button onClick={() => setCurrentScreen('radar')} className="flex items-center gap-3 overflow-hidden text-start">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex-none flex items-center justify-center"><Radar className="w-5 h-5 text-cyan-400" /></div>
            {!collapsed && <div className="truncate"><div className="font-bold text-sm text-slate-100">{BRAND.name}</div><p className="text-[11px] text-cyan-400 truncate">{locale === 'ar' ? BRAND.categoryAr : BRAND.category}</p></div>}
          </button>
          <button onClick={onToggleCollapse} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900" aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? (locale === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : (locale === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />)}</button>
        </div>

        <div className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {items.map(item => { const Icon = item.icon; const active = currentScreen === item.id; return <button key={item.id} onClick={() => setCurrentScreen(item.id)} className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium border ${active ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'}`} title={collapsed ? item.label : undefined}><Icon className="w-5 h-5 flex-none" />{!collapsed && <span className="flex-1 text-start truncate">{item.label}</span>}{!collapsed && item.badge > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{item.badge > 99 ? '99+' : item.badge}</span>}{collapsed && item.badge > 0 && <span className="absolute top-2 end-2 w-2 h-2 rounded-full bg-cyan-400" />}</button>; })}
          <button onClick={() => setCurrentScreen('landing')} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mt-3 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-slate-800/40"><Home className="w-5 h-5 text-cyan-400 flex-none" />{!collapsed && <span className="text-start text-xs">{locale === 'ar' ? 'الصفحة الرئيسية' : 'Website home'}</span>}</button>
        </div>

        {!collapsed && <div className="p-4 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between"><span>{locale === 'ar' ? 'حالة الخدمة' : 'Service'}</span><span className={`flex items-center gap-1.5 font-semibold ${backendStatus === 'online' ? 'text-emerald-400' : backendStatus === 'offline' ? 'text-rose-400' : 'text-amber-400'}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{backendLabel}</span></div>}
      </aside>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-800/80 backdrop-blur-lg pb-safe">
        <div className="grid grid-cols-5 h-16 max-w-md mx-auto px-1">
          {items.map(item => { const Icon = item.icon; const active = currentScreen === item.id; return <button key={item.id} onClick={() => setCurrentScreen(item.id)} className={`relative flex flex-col items-center justify-center gap-1 py-1 ${active ? 'text-cyan-400' : 'text-slate-400'}`}><div className="relative"><Icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />{item.badge > 0 && <span className="absolute -top-1 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">{item.badge > 99 ? '99+' : item.badge}</span>}</div><span className="text-[10px] font-medium truncate max-w-[62px]">{item.label}</span>{active && <span className="absolute bottom-1 w-6 h-0.5 rounded-full bg-cyan-400" />}</button>; })}
        </div>
      </nav>
    </>
  );
};
