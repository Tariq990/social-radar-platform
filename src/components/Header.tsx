import React, { useState } from 'react';
import {
  Radar,
  Plus,
  RotateCw,
  Sparkles,
  Globe,
  Moon,
  Sun,
  CheckCircle2,
  ShieldCheck,
  Home,
  LogOut
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';
import { apiLogout } from '../services/api';

export const Header: React.FC = () => {
  const {
    locale,
    setLocale,
    theme,
    setTheme,
    openAddSource,
    scanAllSources,
    isScanning,
    openDigest,
    openPaywall,
    user,
    setCurrentScreen,
    backendStatus
  } = useRadar();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const t = translations[locale];

  const handleScan = async () => {
    const res = await scanAllSources();
    setToastMessage(locale === 'ar'
      ? `اكتمل الفحص: ${res.scanned} مصدر، ${res.matched} تطابق جديد`
      : `Scan complete: ${res.scanned} sources, ${res.matched} new matches`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiLogout();
    } finally {
      window.location.replace('/');
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md transition-colors">
      {toastMessage && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/20 px-3 py-2 text-center text-xs font-medium text-cyan-300 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 flex-none" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2.5 min-w-0 lg:hidden">
          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-cyan-500/25 flex items-center justify-center shadow-sm shadow-cyan-500/10 flex-none">
            <Radar className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-extrabold text-sm text-slate-100 tracking-tight truncate">MR SCRAP</div>
            <div className="text-[10px] font-semibold text-cyan-400/90 truncate">
              {locale === 'ar' ? BRAND.categoryAr : BRAND.category}
            </div>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-3 min-w-0">
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {locale === 'ar' ? 'الرادار نشط' : 'Radar Online'}
          </span>
          <span className="text-xs text-slate-400 truncate">{locale === 'ar' ? BRAND.taglineAr : BRAND.tagline}</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-none">
          <button
            id="btn-quick-digest"
            onClick={openDigest}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors"
            title={t.quickDigestTitle}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{locale === 'ar' ? 'ملخص' : 'Digest'}</span>
          </button>

          <button
            id="btn-scan-now"
            onClick={handleScan}
            disabled={isScanning}
            className="inline-flex items-center justify-center gap-1.5 w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors disabled:opacity-50"
            title={t.seedActivity}
          >
            <RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isScanning ? t.loading : t.seedActivity}</span>
          </button>

          <div
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-900 border border-slate-800 text-slate-300"
            title="MR SCRAP backend status"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{backendStatus === 'online' ? (locale === 'ar' ? 'الخادم متصل' : 'Backend Live') : (locale === 'ar' ? 'جاري الاتصال' : 'Connecting')}</span>
          </div>

          <button
            id="btn-header-home"
            onClick={() => setCurrentScreen('landing')}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors"
            title={locale === 'ar' ? 'الرجوع للموقع' : 'Return to site'}
          >
            <Home className="w-3.5 h-3.5 text-cyan-400" />
            <span>{locale === 'ar' ? 'الموقع' : 'Site'}</span>
          </button>

          <button
            id="btn-lang-toggle"
            onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors"
            title="Switch Language / تغيير اللغة"
          >
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>{locale === 'en' ? 'عربي' : 'EN'}</span>
          </button>

          <button
            id="btn-theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all active:scale-95"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-cyan-400" />}
          </button>

          <button
            id="btn-plan-badge"
            onClick={openPaywall}
            className="hidden xl:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-950 text-cyan-400 border border-cyan-800/40 hover:bg-cyan-900/40 transition-colors uppercase tracking-wider"
          >
            <ShieldCheck className="w-3 h-3" />
            <span>{user.plan}</span>
          </button>

          <button
            id="btn-logout"
            onClick={handleLogout}
            disabled={loggingOut}
            className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-300 border border-slate-800 transition-colors disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-add-watch-header"
            onClick={() => openAddSource()}
            className="inline-flex items-center justify-center gap-1.5 w-9 h-9 sm:w-auto sm:h-auto sm:px-3.5 sm:py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-500/20 transition-all active:scale-[0.98]"
            title={t.watchAction}
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">{t.watchAction}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
